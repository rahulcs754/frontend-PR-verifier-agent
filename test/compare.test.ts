import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareCaptures, normalizeMessage, statusOf, worstStatus } from '../src/compare.ts';
import type { PageCapture } from '../src/types.ts';

const OPTS = { diffThreshold: 0.002, slowFactor: 1.5, slowMinDeltaMs: 1000 };

function capture(url: string, overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    url,
    status: 200,
    loadMs: 800,
    jsErrors: [],
    consoleErrors: [],
    failedRequests: [],
    brokenImages: [],
    overflowPx: 0,
    ...overrides,
  };
}

const BASE = 'https://example.com/';
const PREVIEW = 'https://example-git-x.vercel.app/';

describe('compareCaptures', () => {
  it('returns no issues when both sides are the same', () => {
    assert.deepEqual(compareCaptures(capture(BASE), capture(PREVIEW), undefined, OPTS), []);
  });

  it('ignores errors that also happen on base, even with different origins', () => {
    const base = capture(BASE, {
      jsErrors: ['x is undefined at https://example.com/_next/static/chunks/main-abc12345.js:1:200'],
      brokenImages: ['https://example.com/old.png'],
      failedRequests: [{ url: 'https://example.com/api/x', method: 'GET', status: 500, resourceType: 'fetch' }],
      overflowPx: 30,
    });
    const preview = capture(PREVIEW, {
      jsErrors: ['x is undefined at https://example-git-x.vercel.app/_next/static/chunks/main-def67890.js:1:210'],
      brokenImages: ['https://example-git-x.vercel.app/old.png'],
      failedRequests: [
        { url: 'https://example-git-x.vercel.app/api/x', method: 'GET', status: 500, resourceType: 'fetch' },
      ],
      overflowPx: 30,
    });
    assert.deepEqual(compareCaptures(base, preview, undefined, OPTS), []);
  });

  it('flags new hard breakages as fail', () => {
    const preview = capture(PREVIEW, {
      jsErrors: ['boom'],
      brokenImages: ['https://example-git-x.vercel.app/logo.png'],
      overflowPx: 120,
      failedRequests: [
        { url: 'https://example-git-x.vercel.app/logo.png', method: 'GET', status: 404, resourceType: 'image' },
        { url: 'https://example-git-x.vercel.app/api/me', method: 'GET', status: 500, resourceType: 'fetch' },
      ],
    });
    const issues = compareCaptures(capture(BASE), preview, undefined, OPTS);
    assert.deepEqual(
      issues.map((i) => [i.severity, i.kind]),
      [
        ['fail', 'js-error'],
        ['fail', 'broken-image'],
        ['fail', 'failed-request'],
        ['fail', 'overflow'],
      ],
    );
    assert.match(issues[2]!.message, /GET \/api\/me HTTP 500/);
  });

  it('treats third-party request failures as warnings', () => {
    const preview = capture(PREVIEW, {
      failedRequests: [{ url: 'https://cdn.other.com/a.js', method: 'GET', status: 0, resourceType: 'script' }],
    });
    const [issue] = compareCaptures(capture(BASE), preview, undefined, OPTS);
    assert.equal(issue?.severity, 'warn');
    assert.match(issue!.message, /failed/);
  });

  it('flags a page that now returns 4xx/5xx', () => {
    const issues = compareCaptures(capture(BASE), capture(PREVIEW, { status: 404 }), undefined, OPTS);
    assert.deepEqual(issues.map((i) => i.kind), ['http-error']);
  });

  it('reports only the navigation error when preview did not load', () => {
    const preview = capture(PREVIEW, { status: 0, navigationError: 'net::ERR_NAME_NOT_RESOLVED', jsErrors: ['x'] });
    const issues = compareCaptures(capture(BASE), preview, undefined, OPTS);
    assert.deepEqual(issues.map((i) => [i.severity, i.kind]), [['fail', 'navigation-error']]);
  });

  it('reports only a redirect when the preview lands on a login wall', () => {
    const preview = capture(PREVIEW, {
      finalUrl: 'https://vercel.com/login?next=%2Fsso-api',
      consoleErrors: ['Provider accounts list is empty'],
    });
    const issues = compareCaptures(capture(BASE), preview, undefined, OPTS);
    assert.deepEqual(issues.map((i) => [i.severity, i.kind]), [['fail', 'redirected']]);
    assert.match(issues[0]!.message, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  });

  it('ignores a redirect that stays on the same site, or that base does too', () => {
    const samesite = capture(PREVIEW, { finalUrl: `${PREVIEW}en` });
    assert.deepEqual(compareCaptures(capture(BASE), samesite, undefined, OPTS), []);
    const both = compareCaptures(
      capture(BASE, { finalUrl: 'https://login.example.org/' }),
      capture(PREVIEW, { finalUrl: 'https://login.example.org/' }),
      undefined,
      OPTS,
    );
    assert.deepEqual(both, []);
  });

  it('warns on new console errors, visual change and slow loads', () => {
    const base = capture(BASE, { consoleErrors: ['old'], loadMs: 1000 });
    const preview = capture(PREVIEW, { consoleErrors: ['old', 'new'], loadMs: 2600 });
    const diff = { diffPixels: 500, totalPixels: 10_000, ratio: 0.05, sizeChanged: true };
    const issues = compareCaptures(base, preview, diff, OPTS);
    assert.deepEqual(
      issues.map((i) => [i.severity, i.kind]),
      [
        ['warn', 'console-error'],
        ['warn', 'visual-change'],
        ['warn', 'slow-load'],
      ],
    );
    assert.match(issues[1]!.message, /5\.0% of pixels changed \(page size changed\)/);
  });

  it('does not call small slowdowns or tiny diffs an issue', () => {
    const base = capture(BASE, { loadMs: 100 });
    const preview = capture(PREVIEW, { loadMs: 400 }); // 4x but only 300ms
    const diff = { diffPixels: 1, totalPixels: 10_000, ratio: 0.0001, sizeChanged: false };
    assert.deepEqual(compareCaptures(base, preview, diff, OPTS), []);
  });
});

describe('normalizeMessage', () => {
  it('strips origin, hashes, line numbers and cache busters', () => {
    assert.equal(
      normalizeMessage('Err at https://a.com/_next/main-1a2b3c4d5e.js?dpl=dpl_abc:10:20', 'https://a.com'),
      'Err at /_next/main-#.js',
    );
  });
});

describe('status helpers', () => {
  it('picks the worst status', () => {
    assert.equal(statusOf([]), 'pass');
    assert.equal(statusOf([{ severity: 'warn', kind: 'slow-load', message: '' }]), 'warn');
    assert.equal(worstStatus(['pass', 'warn', 'fail']), 'fail');
    assert.equal(worstStatus(['pass', 'warn']), 'warn');
  });
});
