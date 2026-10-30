export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface Config {
  /** Production (or main branch) URL, e.g. https://example.com */
  base: string;
  /** Preview deploy URL, e.g. https://example-git-feature.vercel.app */
  preview: string;
  /** Paths to check, e.g. ["/", "/pricing"] */
  routes: string[];
  viewports: Viewport[];
  /** Folder for report.md, report.json and images */
  outDir: string;
  /** Fail on warnings too */
  strict: boolean;
  /** Share of changed pixels (0..1) above which a visual change is reported */
  diffThreshold: number;
  /** pixelmatch per-pixel color threshold (0..1), higher ignores more anti-aliasing noise */
  pixelThreshold: number;
  /** Preview is "slow" when it takes this many times longer than base... */
  slowFactor: number;
  /** ...and at least this many ms longer */
  slowMinDeltaMs: number;
  /** Navigation timeout per page */
  timeoutMs: number;
  /** Extra wait after load, for late renders */
  settleMs: number;
  /** CSS selectors to mask in screenshots (dates, ads, carousels) */
  mask: string[];
  /** Console messages matching any of these (substring) are ignored */
  ignoreConsole: string[];
  /** Extra headers sent only to the preview, e.g. the Vercel protection bypass */
  previewHeaders: Record<string, string>;
}

export type Side = 'base' | 'preview';

export interface FailedRequest {
  url: string;
  method: string;
  /** HTTP status, or 0 when the request failed without a response */
  status: number;
  resourceType: string;
}

export interface PageCapture {
  url: string;
  /** Status of the main document, 0 if navigation failed */
  status: number;
  /** Where the page ended up after redirects, when that differs from url */
  finalUrl?: string;
  /** Set when the page could not be opened at all */
  navigationError?: string;
  loadMs: number;
  jsErrors: string[];
  consoleErrors: string[];
  failedRequests: FailedRequest[];
  brokenImages: string[];
  /** Horizontal overflow in px (document wider than the viewport) */
  overflowPx: number;
  /** Absolute path of the screenshot, missing if navigation failed */
  screenshotPath?: string;
}

export interface DiffResult {
  diffPixels: number;
  totalPixels: number;
  /** diffPixels / totalPixels */
  ratio: number;
  sizeChanged: boolean;
  /** Absolute path of the diff image */
  path?: string;
}

export type Severity = 'fail' | 'warn';

export type IssueKind =
  | 'http-error'
  | 'navigation-error'
  | 'redirected'
  | 'js-error'
  | 'broken-image'
  | 'failed-request'
  | 'overflow'
  | 'console-error'
  | 'visual-change'
  | 'slow-load';

export interface Issue {
  severity: Severity;
  kind: IssueKind;
  message: string;
}

export type Status = 'pass' | 'warn' | 'fail';

export interface RouteResult {
  route: string;
  viewport: string;
  base: PageCapture;
  preview: PageCapture;
  diff?: DiffResult;
  issues: Issue[];
  status: Status;
}

export interface AiChange {
  route: string;
  viewport: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
}

/** Claude's plain-English read of the screenshots */
export interface AiSummary {
  verdict: 'looks-good' | 'needs-review' | 'likely-broken';
  summary: string;
  changes: AiChange[];
  risks: string[];
  /** Model that wrote it (may be a fallback model) */
  model: string;
}

export interface Report {
  base: string;
  preview: string;
  startedAt: string;
  durationMs: number;
  results: RouteResult[];
  summary: {
    status: Status;
    fail: number;
    warn: number;
    checked: number;
  };
  ai?: AiSummary;
}
