import type { FileConfig } from '../config.ts';

/** Where the app looks for per-repo settings, read at the PR's commit. */
export const REPO_CONFIG_PATH = '.github/pr-verify.json';

/** pr-verify.json in the app's repo: CLI options plus a few app-only ones. */
export interface RepoConfig extends Omit<FileConfig, 'base' | 'preview' | 'outDir'> {
  /** Production URL. If missing, the latest successful Production deployment is used. */
  baseUrl?: string;
  /** Also check pages the PR changed (app/.../page.tsx). Default true. */
  autoRoutes?: boolean;
  /** Most routes to check per run. Default 10. */
  maxRoutes?: number;
}

export function parseRepoConfig(text: string | undefined): RepoConfig {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Never let a repo file pick where reports go or what is compared against what.
    const { base: _b, preview: _p, outDir: _o, ...rest } = parsed as Record<string, unknown>;
    return rest as RepoConfig;
  } catch {
    return {};
  }
}
