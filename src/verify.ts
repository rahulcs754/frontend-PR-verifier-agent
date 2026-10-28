import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { capturePage } from './capture.ts';
import { compareCaptures, statusOf, worstStatus } from './compare.ts';
import { diffImages } from './diff.ts';
import type { Config, DiffResult, PageCapture, Report, RouteResult, Viewport } from './types.ts';

export interface VerifyHooks {
  onResult?: (result: RouteResult) => void;
}

/** Runs every route on every viewport against base and preview, and compares them. */
export async function verify(config: Config, hooks: VerifyHooks = {}): Promise<Report> {
  const started = Date.now();
  const outDir = resolve(config.outDir);
  const imagesDir = join(outDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  const browser = await chromium.launch();
  const results: RouteResult[] = [];
  try {
    for (const route of config.routes) {
      for (const viewport of config.viewports) {
        const result = await verifyRoute(browser, config, route, viewport, imagesDir);
        results.push(result);
        hooks.onResult?.(result);
      }
    }
  } finally {
    await browser.close();
  }

  const fail = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'fail').length, 0);
  const warn = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warn').length, 0);

  return {
    base: config.base,
    preview: config.preview,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    results,
    summary: {
      status: worstStatus(results.map((r) => r.status)),
      fail,
      warn,
      checked: results.length,
    },
  };
}

async function verifyRoute(
  browser: Browser,
  config: Config,
  route: string,
  viewport: Viewport,
  imagesDir: string,
): Promise<RouteResult> {
  const name = `${slugify(route)}-${viewport.name}`;
  const shared = {
    viewport,
    timeoutMs: config.timeoutMs,
    settleMs: config.settleMs,
    mask: config.mask,
    ignoreConsole: config.ignoreConsole,
  };

  // Base and preview run side by side so they see the same network conditions.
  const [base, preview] = await Promise.all([
    capturePage(browser, config.base + route, {
      ...shared,
      screenshotPath: join(imagesDir, `${name}-base.png`),
    }),
    capturePage(browser, config.preview + route, {
      ...shared,
      headers: config.previewHeaders,
      screenshotPath: join(imagesDir, `${name}-preview.png`),
    }),
  ]);

  const diff = await diffScreenshots(base, preview, join(imagesDir, `${name}-diff.png`), config.pixelThreshold);
  const issues = compareCaptures(base, preview, diff, config);
  return { route, viewport: viewport.name, base, preview, diff, issues, status: statusOf(issues) };
}

async function diffScreenshots(
  base: PageCapture,
  preview: PageCapture,
  path: string,
  pixelThreshold: number,
): Promise<DiffResult | undefined> {
  if (!base.screenshotPath || !preview.screenshotPath) return undefined;
  const [a, b] = await Promise.all([readFile(base.screenshotPath), readFile(preview.screenshotPath)]);
  const { png, ...result } = diffImages(a, b, pixelThreshold);
  if (result.diffPixels === 0) return result;
  await writeFile(path, png);
  return { ...result, path };
}

/** "/" -> "home", "/blog/my-post" -> "blog-my-post" */
export function slugify(route: string): string {
  const slug = route
    .replace(/[?#].*$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'home';
}
