import type { Browser, Page } from 'playwright';
import type { Config, FailedRequest, PageCapture, Viewport } from './types.ts';

/** Stops animations, transitions and the blinking caret so screenshots are stable. */
const STABLE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

const MAX_MESSAGE_LENGTH = 300;

export interface CaptureOptions
  extends Pick<Config, 'timeoutMs' | 'settleMs' | 'mask' | 'ignoreConsole'> {
  viewport: Viewport;
  headers?: Record<string, string>;
  /** Where to save the full-page screenshot */
  screenshotPath: string;
}

/** Opens one URL in a fresh context and collects everything we compare later. */
export async function capturePage(browser: Browser, url: string, opts: CaptureOptions): Promise<PageCapture> {
  const context = await browser.newContext({
    viewport: { width: opts.viewport.width, height: opts.viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    extraHTTPHeaders: opts.headers,
    // Same locale and timezone on both sides so dates render the same.
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();

  const result: PageCapture = {
    url,
    status: 0,
    loadMs: 0,
    jsErrors: [],
    consoleErrors: [],
    failedRequests: [],
    brokenImages: [],
    overflowPx: 0,
  };

  page.on('pageerror', (err) => result.jsErrors.push(clip(err.message)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = clip(msg.text());
    // Failed resources are already reported as failed requests.
    if (text.startsWith('Failed to load resource')) return;
    if (opts.ignoreConsole.some((p) => text.includes(p))) return;
    result.consoleErrors.push(text);
  });
  page.on('response', (res) => {
    if (res.status() < 400 || res.request().isNavigationRequest()) return;
    result.failedRequests.push(toFailed(res.url(), res.request().method(), res.status(), res.request().resourceType()));
  });
  page.on('requestfailed', (req) => {
    // Aborted requests (e.g. cancelled prefetches) are noise.
    if (req.failure()?.errorText.includes('ERR_ABORTED')) return;
    result.failedRequests.push(toFailed(req.url(), req.method(), 0, req.resourceType()));
  });

  try {
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs });
    result.loadMs = Date.now() - started;
    result.status = response?.status() ?? 0;

    // Network idle is best effort: analytics and websockets may never go idle.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.addStyleTag({ content: STABLE_CSS }).catch(() => {});
    await scrollThrough(page);
    await page.waitForTimeout(opts.settleMs);

    result.brokenImages = await findBrokenImages(page);
    result.overflowPx = await measureOverflow(page);

    await page.screenshot({
      path: opts.screenshotPath,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      mask: opts.mask.map((sel) => page.locator(sel)),
      timeout: opts.timeoutMs,
    });
    result.screenshotPath = opts.screenshotPath;
  } catch (err) {
    result.navigationError = clip(err instanceof Error ? err.message.split('\n')[0]! : String(err));
  } finally {
    await context.close();
  }

  return result;
}

/** Scrolls to the bottom and back so lazy images and sections load. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const max = Math.min(document.documentElement.scrollHeight, 20_000);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
}

async function findBrokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.images)
      // complete + naturalWidth 0 means the browser gave up on the image.
      .filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src))
      .map((img) => img.currentSrc || img.src),
  );
}

async function measureOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

function toFailed(url: string, method: string, status: number, resourceType: string): FailedRequest {
  return { url, method, status, resourceType };
}

function clip(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...` : text;
}
