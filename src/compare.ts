import type { Config, DiffResult, Issue, PageCapture, Status } from './types.ts';

type CompareOptions = Pick<Config, 'diffThreshold' | 'slowFactor' | 'slowMinDeltaMs'>;

/** Overflow below this many px is usually a scrollbar or rounding, not a bug. */
const OVERFLOW_TOLERANCE_PX = 2;

/**
 * Finds issues that are new in the preview. Anything that is also broken on
 * base is ignored, so a PR is only blamed for what it changed.
 */
export function compareCaptures(
  base: PageCapture,
  preview: PageCapture,
  diff: DiffResult | undefined,
  opts: CompareOptions,
): Issue[] {
  const issues: Issue[] = [];
  const baseOrigin = originOf(base.url);
  const previewOrigin = originOf(preview.url);
  // Same message on both sides once each side's own origin is removed.
  const norm = (text: string, origin: string) => normalizeMessage(text, origin);
  const baseSet = (list: string[]) => new Set(list.map((t) => norm(t, baseOrigin)));
  const onlyNew = (prev: string[], baseList: string[]) => {
    const known = baseSet(baseList);
    return unique(prev).filter((t) => !known.has(norm(t, previewOrigin)));
  };

  if (preview.navigationError) {
    if (!base.navigationError) {
      issues.push({
        severity: 'fail',
        kind: 'navigation-error',
        message: `Page did not load: ${preview.navigationError}`,
      });
    }
    // Nothing else is meaningful when the page did not open.
    return issues;
  }

  if (preview.status >= 400 && base.status < 400) {
    issues.push({
      severity: 'fail',
      kind: 'http-error',
      message: `Page returned HTTP ${preview.status} (base: ${base.status || 'n/a'})`,
    });
  }

  for (const err of onlyNew(preview.jsErrors, base.jsErrors)) {
    issues.push({ severity: 'fail', kind: 'js-error', message: `JS exception: ${err}` });
  }

  for (const src of onlyNew(preview.brokenImages, base.brokenImages)) {
    issues.push({ severity: 'fail', kind: 'broken-image', message: `Broken image: ${src}` });
  }

  const baseRequests = new Set(base.failedRequests.map((r) => requestKey(r.url, r.status, baseOrigin)));
  const seenRequests = new Set<string>();
  const brokenImages = new Set(preview.brokenImages);
  for (const req of preview.failedRequests) {
    // Already reported above as a broken image.
    if (req.resourceType === 'image' && brokenImages.has(req.url)) continue;
    const key = requestKey(req.url, req.status, previewOrigin);
    if (baseRequests.has(key) || seenRequests.has(key)) continue;
    seenRequests.add(key);
    // Own-origin failures are the PR's fault. Third-party ones are often flaky.
    const firstParty = originOf(req.url) === previewOrigin;
    const what = req.status === 0 ? 'failed' : `HTTP ${req.status}`;
    issues.push({
      severity: firstParty ? 'fail' : 'warn',
      kind: 'failed-request',
      message: `${req.method} ${shortUrl(req.url, previewOrigin)} ${what} (${req.resourceType})`,
    });
  }

  if (preview.overflowPx > OVERFLOW_TOLERANCE_PX && base.overflowPx <= OVERFLOW_TOLERANCE_PX) {
    issues.push({
      severity: 'fail',
      kind: 'overflow',
      message: `Page scrolls sideways: content is ${preview.overflowPx}px wider than the screen`,
    });
  }

  for (const msg of onlyNew(preview.consoleErrors, base.consoleErrors)) {
    issues.push({ severity: 'warn', kind: 'console-error', message: `Console error: ${msg}` });
  }

  if (diff && diff.ratio > opts.diffThreshold) {
    const pct = formatPercent(diff.ratio);
    issues.push({
      severity: 'warn',
      kind: 'visual-change',
      message: `${pct} of pixels changed${diff.sizeChanged ? ' (page size changed)' : ''}`,
    });
  }

  const delta = preview.loadMs - base.loadMs;
  if (base.loadMs > 0 && preview.loadMs > base.loadMs * opts.slowFactor && delta >= opts.slowMinDeltaMs) {
    issues.push({
      severity: 'warn',
      kind: 'slow-load',
      message: `Loads slower: ${formatMs(preview.loadMs)} vs ${formatMs(base.loadMs)} on base`,
    });
  }

  return issues;
}

export function statusOf(issues: Issue[]): Status {
  if (issues.some((i) => i.severity === 'fail')) return 'fail';
  if (issues.length > 0) return 'warn';
  return 'pass';
}

/** Worst status wins: fail > warn > pass. */
export function worstStatus(statuses: Status[]): Status {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

/**
 * Removes the deploy origin, cache-busting hashes and line/column numbers so
 * the same error on base and preview compares equal.
 */
export function normalizeMessage(text: string, origin: string): string {
  let out = origin ? text.split(origin).join('') : text;
  out = out
    .replace(/[?&](?:v|t|ts|_|dpl)=[\w.-]+/g, '') // cache busters, Vercel dpl= ids
    .replace(/\b[0-9a-f]{8,}\b/gi, '#') // build hashes in chunk names
    .replace(/:\d+:\d+\b/g, '') // :line:col
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

function requestKey(url: string, status: number, origin: string): string {
  return `${status} ${normalizeMessage(url, origin)}`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function shortUrl(url: string, origin: string): string {
  const s = url.startsWith(origin) ? url.slice(origin.length) || '/' : url;
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

export function formatPercent(ratio: number): string {
  const pct = ratio * 100;
  return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
