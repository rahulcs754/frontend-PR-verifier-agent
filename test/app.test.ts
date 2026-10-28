import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { GitHubApi } from '../src/app/github.ts';
import { SerialQueue } from '../src/app/queue.ts';
import { parseRepoConfig } from '../src/app/repo-config.ts';
import { pickRoutes, routeForFile } from '../src/app/routes.ts';
import { isReadyPreview, runForDeployment, type DeploymentEvent } from '../src/app/run.ts';
import { newRunId, RunStore } from '../src/store.ts';
import type { Config, Report } from '../src/types.ts';

describe('routes from changed files', () => {
  it('maps App Router files to routes', () => {
    const cases: Array<[string, string | undefined]> = [
      ['app/page.tsx', '/'],
      ['src/app/(marketing)/pricing/page.tsx', '/pricing'],
      ['app/blog/layout.tsx', '/blog'],
      ['apps/web/app/about/team/page.mdx', '/about/team'],
      ['app/blog/[slug]/page.tsx', undefined],
      ['app/@modal/page.tsx', undefined],
      ['app/_lib/page.tsx', undefined],
      ['app/api/users/route.ts', undefined],
      ['components/Button.tsx', undefined],
    ];
    for (const [file, route] of cases) assert.equal(routeForFile(file), route, file);
  });

  it('keeps configured routes first and caps the list', () => {
    assert.deepEqual(pickRoutes(['/', '/pricing'], ['app/pricing/page.tsx', 'app/docs/page.tsx'], 10), [
      '/',
      '/pricing',
      '/docs',
    ]);
    assert.deepEqual(pickRoutes([], ['app/a/page.tsx', 'app/b/page.tsx'], 2), ['/', '/a']);
  });
});

describe('parseRepoConfig', () => {
  it('ignores bad JSON and keys a repo must not set', () => {
    assert.deepEqual(parseRepoConfig('nope'), {});
    assert.deepEqual(parseRepoConfig(undefined), {});
    assert.deepEqual(parseRepoConfig('{"routes":["/x"],"outDir":"/etc","preview":"http://evil"}'), { routes: ['/x'] });
  });
});

describe('isReadyPreview', () => {
  const e = (over: Partial<DeploymentEvent>): DeploymentEvent => ({
    repo: 'o/r',
    sha: 'abc',
    environment: 'Preview',
    state: 'success',
    environmentUrl: 'https://x.vercel.app',
    ...over,
  });
  it('only accepts successful non-production deploys with a URL', () => {
    assert.equal(isReadyPreview(e({})), true);
    assert.equal(isReadyPreview(e({ environment: 'Preview – web' })), true);
    assert.equal(isReadyPreview(e({ environment: 'Production' })), false);
    assert.equal(isReadyPreview(e({ state: 'pending' })), false);
    assert.equal(isReadyPreview(e({ environmentUrl: null })), false);
  });
});

describe('SerialQueue', () => {
  it('runs one job at a time and drops waiting duplicates', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const queue = new SerialQueue();
    const job = (name: string) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(name);
      active--;
    };
    assert.equal(queue.push('a', job('a')), true);
    assert.equal(queue.push('b', job('b')), true);
    assert.equal(queue.push('b', job('b2')), false);
    await queue.idle();
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(maxActive, 1);
  });
});

describe('RunStore', () => {
  it('makes sortable safe ids and rejects path tricks', async () => {
    const id = newRunId('Acme/Web.App', 12, 'abcdef1234', new Date('2026-10-28T07:15:00.123Z'));
    assert.equal(id, '20261028T071500123Z-acme-web-app-12-abcdef1');
    const store = new RunStore(tmpdir());
    assert.throws(() => store.dirFor('../etc'));
    assert.equal(await store.get('../etc'), undefined);
  });
});

/** In-memory GitHub that records what the app did. */
function fakeGitHub(over: Partial<GitHubApi> = {}) {
  const checks: Array<{ status: string; conclusion?: string; title: string }> = [];
  const comments: string[] = [];
  const gh: GitHubApi = {
    findOpenPr: async () => ({ number: 7, title: 'New pricing page' }),
    changedFiles: async () => ['app/pricing/page.tsx', 'README.md'],
    readFile: async () => JSON.stringify({ routes: ['/'], viewports: ['mobile'] }),
    productionUrl: async () => 'https://acme.com',
    upsertComment: async (_pr, body) => {
      comments.push(body);
      return 'https://github.com/o/r/pull/7#issuecomment-1';
    },
    setCheck: async (_sha, state, output) => {
      checks.push({ ...state, title: output.title });
      return 'https://github.com/o/r/runs/1';
    },
    ...over,
  };
  return { gh, checks, comments };
}

function fakeReport(config: Config, status: Report['summary']['status']): Report {
  return {
    base: config.base,
    preview: config.preview,
    startedAt: new Date().toISOString(),
    durationMs: 1200,
    results: [],
    summary: { status, fail: status === 'fail' ? 1 : 0, warn: status === 'warn' ? 1 : 0, checked: 2 },
  };
}

describe('runForDeployment', () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pr-verify-app-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const event: DeploymentEvent = {
    repo: 'o/r',
    sha: '1234567890abcdef',
    environment: 'Preview',
    state: 'success',
    environmentUrl: 'https://r-git-feat.vercel.app',
  };

  it('checks configured + changed routes, comments, and completes the check', async () => {
    const store = new RunStore(dir);
    const { gh, checks, comments } = fakeGitHub();
    let seen: Config | undefined;
    const run = await runForDeployment(gh, event, {
      store,
      verify: async (config) => {
        seen = config;
        return fakeReport(config, 'fail');
      },
      dashboardUrl: 'https://pilot.example.com',
      previewHeaders: { 'x-vercel-protection-bypass': 's3cret' },
    });

    assert.equal(seen?.base, 'https://acme.com');
    assert.equal(seen?.preview, 'https://r-git-feat.vercel.app');
    assert.deepEqual(seen?.routes, ['/', '/pricing']);
    assert.deepEqual(seen?.viewports.map((v) => v.name), ['mobile']);
    assert.equal(seen?.previewHeaders['x-vercel-protection-bypass'], 's3cret');

    assert.equal(run?.status, 'done');
    assert.equal(run?.prNumber, 7);
    assert.deepEqual(checks.map((c) => c.conclusion ?? c.status), ['in_progress', 'failure']);
    assert.equal(comments.length, 1);
    assert.match(comments[0]!, /pilot\.example\.com\/runs\//);

    const saved = await store.get(run!.id);
    assert.equal(saved?.status, 'done');
    assert.equal(saved?.summary?.status, 'fail');
    assert.match(await readFile(join(store.dirFor(run!.id), 'report.md'), 'utf8'), /PreviewPilot/);
    assert.equal((await store.list({ repo: 'o/r' })).length, 1);
  });

  it('skips commits without an open PR', async () => {
    const { gh, checks } = fakeGitHub({ findOpenPr: async () => undefined });
    const run = await runForDeployment(gh, event, { store: new RunStore(dir), verify: async () => assert.fail() });
    assert.equal(run, undefined);
    assert.equal(checks.length, 0);
  });

  it('asks for a baseUrl when there is no production deploy', async () => {
    const { gh, checks } = fakeGitHub({ productionUrl: async () => undefined, readFile: async () => undefined });
    const run = await runForDeployment(gh, event, { store: new RunStore(dir), verify: async () => assert.fail() });
    assert.equal(run, undefined);
    assert.equal(checks[0]?.conclusion, 'neutral');
    assert.match(checks[0]!.title, /No production URL/);
  });

  it('records errors and leaves a neutral check', async () => {
    const store = new RunStore(dir);
    const { gh, checks } = fakeGitHub();
    const run = await runForDeployment(gh, event, {
      store,
      verify: async () => {
        throw new Error('browser crashed');
      },
    });
    assert.equal(run?.status, 'error');
    assert.equal(run?.error, 'browser crashed');
    assert.equal(checks.at(-1)?.conclusion, 'neutral');
    assert.equal((await store.get(run!.id))?.status, 'error');
  });
});
