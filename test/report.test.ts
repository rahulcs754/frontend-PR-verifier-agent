import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMENT_MARKER, escapeMd, renderMarkdown, toJson } from '../src/report.ts';
import type { PageCapture, Report, RouteResult } from '../src/types.ts';

const page = (url: string, extra: Partial<PageCapture> = {}): PageCapture => ({
  url,
  status: 200,
  loadMs: 900,
  jsErrors: [],
  consoleErrors: [],
  failedRequests: [],
  brokenImages: [],
  overflowPx: 0,
  screenshotPath: '/tmp/out/images/home-desktop-base.png',
  ...extra,
});

function result(overrides: Partial<RouteResult>): RouteResult {
  return {
    route: '/',
    viewport: 'desktop',
    base: page('https://a.com/'),
    preview: page('https://b.vercel.app/'),
    diff: { diffPixels: 0, totalPixels: 100, ratio: 0, sizeChanged: false },
    issues: [],
    status: 'pass',
    ...overrides,
  };
}

function report(results: RouteResult[], summary: Report['summary']): Report {
  return {
    base: 'https://a.com',
    preview: 'https://b.vercel.app',
    startedAt: '2026-10-28T00:00:00.000Z',
    durationMs: 4200,
    results,
    summary,
  };
}

describe('renderMarkdown', () => {
  it('renders a passing report', () => {
    const md = renderMarkdown(report([result({})], { status: 'pass', fail: 0, warn: 0, checked: 1 }));
    assert.ok(md.startsWith(COMMENT_MARKER));
    assert.match(md, /## ✅ PreviewPilot: no new issues/);
    assert.match(md, /\| `\/` \| desktop \| ✅ OK \| none \| 900ms \/ 900ms \|/);
    assert.doesNotMatch(md, /What changed/);
  });

  it('lists issues with fails first and links the artifact', () => {
    const r = result({
      route: '/pricing',
      viewport: 'mobile',
      status: 'fail',
      diff: { diffPixels: 30, totalPixels: 100, ratio: 0.3, sizeChanged: true },
      issues: [
        { severity: 'warn', kind: 'visual-change', message: '30% of pixels changed' },
        { severity: 'fail', kind: 'js-error', message: 'JS exception: <b>x</b> is not a function' },
      ],
    });
    const md = renderMarkdown(report([r], { status: 'fail', fail: 1, warn: 1, checked: 1 }), {
      artifactUrl: 'https://github.com/o/r/actions/runs/1',
    });
    assert.match(md, /## ❌ PreviewPilot: 1 breaking issue, 1 warning/);
    assert.match(md, /❌ 1 fail, 1 warn \| 30\.0% \(resized\)/);
    const failAt = md.indexOf('JS exception');
    const warnAt = md.indexOf('30% of pixels changed');
    assert.ok(failAt > 0 && failAt < warnAt, 'fail is listed before warn');
    assert.match(md, /\\<b\\>x\\<\/b\\>/);
    assert.match(md, /\[Screenshots and diff images\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
  });

  it('caps long issue lists', () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({
      severity: 'warn' as const,
      kind: 'console-error' as const,
      message: `err ${i}`,
    }));
    const md = renderMarkdown(report([result({ issues, status: 'warn' })], { status: 'warn', fail: 0, warn: 12, checked: 1 }));
    assert.match(md, /…and 4 more/);
  });
});

describe('renderMarkdown with Claude review', () => {
  it('puts the review above the table', () => {
    const r = report([result({})], { status: 'pass', fail: 0, warn: 0, checked: 1 });
    r.ai = {
      verdict: 'likely-broken',
      summary: 'The pricing cards overlap on mobile.',
      changes: [{ route: '/pricing', viewport: 'mobile', description: 'Cards overlap', risk: 'high' }],
      risks: ['Check the checkout button'],
      model: 'claude-opus-5-5',
    };
    const md = renderMarkdown(r);
    assert.match(md, /### Claude's review\n\n\*\*🔴 Looks broken\.\*\* The pricing cards overlap on mobile\./);
    assert.match(md, /- 🔴 `\/pricing` · mobile: Cards overlap/);
    assert.match(md, /\*\*Check by hand:\*\*\n- Check the checkout button/);
    assert.ok(md.indexOf("Claude's review") < md.indexOf('| Page |'));
  });
});

describe('toJson', () => {
  it('replaces absolute paths with relative ones', () => {
    const json = JSON.parse(toJson(report([result({})], { status: 'pass', fail: 0, warn: 0, checked: 1 })));
    assert.equal(json.results[0].base.screenshotPath, 'images/home-desktop-base.png');
  });
});

describe('escapeMd', () => {
  it('escapes table pipes, mentions and newlines', () => {
    assert.equal(escapeMd('a|b @team\nnext'), 'a\\|b @​team next');
  });
});
