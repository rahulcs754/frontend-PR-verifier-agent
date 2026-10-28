import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildConfig } from '../src/config.ts';
import { verify } from '../src/verify.ts';
import { serveDir } from './helpers/static-server.ts';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('verify (real browser)', () => {
  let base: Awaited<ReturnType<typeof serveDir>>;
  let preview: Awaited<ReturnType<typeof serveDir>>;
  let outDir: string;

  before(async () => {
    base = await serveDir(join(fixtures, 'base'));
    preview = await serveDir(join(fixtures, 'preview'));
    outDir = await mkdtemp(join(tmpdir(), 'pr-verify-'));
  });

  after(async () => {
    await Promise.all([base.close(), preview.close(), rm(outDir, { recursive: true, force: true })]);
  });

  it('finds only the issues the preview introduced', async () => {
    const config = buildConfig(
      {},
      {
        base: base.url,
        preview: preview.url,
        routes: ['/', '/about', '/gone'],
        viewports: ['mobile'],
        outDir,
        settleMs: 0,
      },
    );
    const report = await verify(config);
    const byRoute = Object.fromEntries(report.results.map((r) => [r.route, r]));

    const home = byRoute['/']!;
    const kinds = home.issues.map((i) => `${i.severity}:${i.kind}`).sort();
    assert.deepEqual(kinds, [
      'fail:broken-image',
      'fail:js-error',
      'fail:overflow',
      'warn:console-error',
      'warn:visual-change',
    ]);
    // The console error that also exists on base is not reported.
    assert.ok(home.issues.every((i) => !i.message.includes('legacy warning')));
    assert.ok(home.diff?.path && existsSync(home.diff.path));

    assert.equal(byRoute['/about']!.status, 'pass');
    assert.equal(byRoute['/about']!.diff?.diffPixels, 0);

    // 404 on both sides is not the PR's fault.
    assert.equal(byRoute['/gone']!.status, 'pass');

    assert.equal(report.summary.status, 'fail');
  });
});
