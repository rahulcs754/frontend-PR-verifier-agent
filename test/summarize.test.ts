import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { PNG } from 'pngjs';
import { cropTop, pickForReview, summarizeReport } from '../src/summarize.ts';
import type { PageCapture, Report, RouteResult } from '../src/types.ts';

function png(width: number, height: number): Buffer {
  const img = new PNG({ width, height });
  img.data.fill(255);
  return PNG.sync.write(img);
}

const page = (url: string, screenshotPath?: string): PageCapture => ({
  url,
  status: 200,
  loadMs: 500,
  jsErrors: [],
  consoleErrors: [],
  failedRequests: [],
  brokenImages: [],
  overflowPx: 0,
  screenshotPath,
});

function result(route: string, ratio: number, status: RouteResult['status'], shot?: string): RouteResult {
  return {
    route,
    viewport: 'desktop',
    base: page('https://a.com' + route, shot),
    preview: page('https://b.app' + route, shot),
    diff: { diffPixels: ratio * 100, totalPixels: 100, ratio, sizeChanged: false },
    issues: status === 'pass' ? [] : [{ severity: status, kind: 'visual-change', message: 'changed' }],
    status,
  };
}

/** Stands in for the SDK client and records the request. */
function fakeClient(reply: object) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return reply;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe('pickForReview', () => {
  it('keeps changed pages, failing first, then biggest diff', () => {
    const picked = pickForReview(
      [
        result('/same', 0, 'pass', 'x.png'),
        result('/small', 0.01, 'warn', 'x.png'),
        result('/big', 0.4, 'warn', 'x.png'),
        result('/broken', 0.02, 'fail', 'x.png'),
        result('/no-shot', 0.5, 'warn'),
      ],
      3,
    );
    assert.deepEqual(
      picked.map((r) => r.route),
      ['/broken', '/big', '/small'],
    );
  });
});

describe('cropTop', () => {
  it('crops tall images and leaves short ones alone', () => {
    const short = png(10, 20);
    assert.equal(cropTop(short, 50).data, short);
    const { data, cropped } = cropTop(png(10, 200), 50);
    assert.equal(cropped, true);
    assert.equal(PNG.sync.read(data).height, 50);
  });
});

describe('summarizeReport', () => {
  let dir: string;
  let shot: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pr-verify-ai-'));
    shot = join(dir, 'shot.png');
    await writeFile(shot, png(20, 3000));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const report = (results: RouteResult[]): Report => ({
    base: 'https://a.com',
    preview: 'https://b.app',
    startedAt: '',
    durationMs: 1,
    results,
    summary: { status: 'warn', fail: 0, warn: 1, checked: results.length },
  });

  it('skips the API call when nothing changed', async () => {
    const { client, calls } = fakeClient({});
    assert.equal(await summarizeReport(report([result('/', 0, 'pass', shot)]), { client }), undefined);
    assert.equal(calls.length, 0);
  });

  it('sends screenshots with fallbacks and returns the parsed review', async () => {
    const parsed = { verdict: 'needs-review', summary: 'Hero color changed.', changes: [], risks: ['Check dark mode'] };
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', parsed_output: parsed, model: 'claude-opus-5-5' });
    const ai = await summarizeReport(report([result('/', 0.3, 'warn', shot)]), { client });

    assert.deepEqual(ai, { ...parsed, model: 'claude-opus-5-5' });
    const req = calls[0]!;
    assert.equal(req.model, 'claude-opus-5-5');
    assert.equal(req.fallbacks, 'default');
    const content = (req.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]!.content;
    // base + preview (no diff path in this fixture)
    assert.equal(content.filter((b) => b.type === 'image').length, 2);
    assert.ok(content.some((b) => b.text?.includes('cropped to the top')));
  });

  it('returns undefined on a refusal', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null, model: 'x' });
    assert.equal(await summarizeReport(report([result('/', 0.3, 'warn', shot)]), { client }), undefined);
  });
});
