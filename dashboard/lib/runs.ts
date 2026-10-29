import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/*
 * Reads the runs the GitHub App saves (see src/store.ts in the root package):
 * <RUNS_DIR>/<id>/run.json, report.json, images/*.png
 * The types below mirror the ones in src/types.ts and src/store.ts.
 */

export type Status = 'pass' | 'warn' | 'fail';
export type Verdict = 'looks-good' | 'needs-review' | 'likely-broken';

export interface Summary {
  status: Status;
  fail: number;
  warn: number;
  checked: number;
}

export interface Run {
  id: string;
  repo: string;
  prNumber: number;
  prTitle?: string;
  sha: string;
  baseUrl: string;
  previewUrl: string;
  routes: string[];
  status: 'queued' | 'running' | 'done' | 'error';
  createdAt: string;
  finishedAt?: string;
  error?: string;
  summary?: Summary;
  verdict?: Verdict;
  commentUrl?: string;
  checkRunUrl?: string;
}

export interface Issue {
  severity: 'fail' | 'warn';
  kind: string;
  message: string;
}

export interface PageCapture {
  url: string;
  status: number;
  navigationError?: string;
  loadMs: number;
  /** "images/<file>.png", relative to the run folder */
  screenshotPath?: string;
}

export interface RouteResult {
  route: string;
  viewport: string;
  base: PageCapture;
  preview: PageCapture;
  diff?: { diffPixels: number; totalPixels: number; ratio: number; sizeChanged: boolean; path?: string };
  issues: Issue[];
  status: Status;
}

export interface AiSummary {
  verdict: Verdict;
  summary: string;
  changes: Array<{ route: string; viewport: string; description: string; risk: 'low' | 'medium' | 'high' }>;
  risks: string[];
  model: string;
}

export interface Report {
  base: string;
  preview: string;
  startedAt: string;
  durationMs: number;
  results: RouteResult[];
  summary: Summary;
  ai?: AiSummary;
}

export function runsDir(): string {
  // Runs live outside the app and are read at request time, not bundled.
  return resolve(/*turbopackIgnore: true*/ process.env.RUNS_DIR ?? '../runs');
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/;
const SAFE_IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.png$/;

export async function listRuns(filter: { repo?: string } = {}): Promise<Run[]> {
  let ids: string[];
  try {
    ids = (await readdir(runsDir(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const runs = (await Promise.all(ids.filter((id) => SAFE_ID.test(id)).map(getRun))).filter(
    (r): r is Run => !!r && (!filter.repo || r.repo === filter.repo),
  );
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(id: string): Promise<Run | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  return readJson<Run>(join(runsDir(), id, 'run.json'));
}

export async function getReport(id: string): Promise<Report | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  return readJson<Report>(join(runsDir(), id, 'report.json'));
}

/** Absolute path of a run image, or undefined for anything that is not a plain PNG name. */
export function imagePath(id: string, file: string): string | undefined {
  if (!SAFE_ID.test(id) || !SAFE_IMAGE.test(file)) return undefined;
  return join(runsDir(), id, 'images', file);
}

/** "images/home-desktop-base.png" -> URL served by the image route */
export function imageUrl(id: string, path: string | undefined): string | undefined {
  const file = path?.split('/').pop();
  return file && SAFE_IMAGE.test(file) ? `/runs/${id}/images/${file}` : undefined;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
