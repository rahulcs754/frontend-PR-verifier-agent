import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AiSummary, Report } from './types.ts';

export type RunStatus = 'queued' | 'running' | 'done' | 'error';

/** One PreviewPilot run on one PR commit, as the GitHub App and dashboard see it. */
export interface RunRecord {
  id: string;
  /** "owner/name" */
  repo: string;
  prNumber: number;
  prTitle?: string;
  sha: string;
  baseUrl: string;
  previewUrl: string;
  routes: string[];
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  error?: string;
  /** Copied from the report so the run list loads without reading every report */
  summary?: Report['summary'];
  verdict?: AiSummary['verdict'];
  commentUrl?: string;
  checkRunUrl?: string;
}

/**
 * Runs on disk: <root>/<id>/run.json, plus report.json, report.md and images/
 * written by verify. Shared by the GitHub App (writes) and dashboard (reads).
 */
export class RunStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  dirFor(id: string): string {
    if (!isSafeId(id)) throw new Error(`Bad run id: ${id}`);
    return join(this.root, id);
  }

  async save(run: RunRecord): Promise<void> {
    const dir = this.dirFor(run.id);
    await mkdir(dir, { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const tmp = join(dir, `run.json.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(run, null, 2) + '\n');
    await rename(tmp, join(dir, 'run.json'));
  }

  async get(id: string): Promise<RunRecord | undefined> {
    if (!isSafeId(id)) return undefined;
    return readJson<RunRecord>(join(this.root, id, 'run.json'));
  }

  async getReport(id: string): Promise<Report | undefined> {
    if (!isSafeId(id)) return undefined;
    return readJson<Report>(join(this.root, id, 'report.json'));
  }

  /** Newest first. */
  async list(filter: { repo?: string; prNumber?: number; limit?: number } = {}): Promise<RunRecord[]> {
    let ids: string[];
    try {
      ids = (await readdir(this.root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const runs = (await Promise.all(ids.filter(isSafeId).map((id) => this.get(id)))).filter(
      (r): r is RunRecord =>
        !!r && (!filter.repo || r.repo === filter.repo) && (!filter.prNumber || r.prNumber === filter.prNumber),
    );
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter.limit ? runs.slice(0, filter.limit) : runs;
  }
}

/** Sortable, filesystem-safe id: 20261028T071500123Z-owner-repo-12-abc1234 */
export function newRunId(repo: string, prNumber: number, sha: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  const slug = repo.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  return `${stamp}-${slug}-${prNumber}-${sha.slice(0, 7)}`;
}

export function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id) && id.length <= 200;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
