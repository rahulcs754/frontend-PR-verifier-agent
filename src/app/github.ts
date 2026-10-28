import type { Octokit } from '@octokit/core';
import { COMMENT_MARKER } from '../report.ts';

export const CHECK_NAME = 'PreviewPilot';

export interface CheckOutput {
  title: string;
  summary: string;
}

/** The few GitHub calls the app makes, so the run logic can be tested with a fake. */
export interface GitHubApi {
  /** Open PR whose head is this commit */
  findOpenPr(sha: string): Promise<{ number: number; title: string } | undefined>;
  changedFiles(prNumber: number): Promise<string[]>;
  /** File contents at a commit, or undefined if missing */
  readFile(path: string, ref: string): Promise<string | undefined>;
  /** URL of the latest successful production deployment */
  productionUrl(): Promise<string | undefined>;
  /** Creates or updates the single PreviewPilot comment; returns its URL */
  upsertComment(prNumber: number, body: string): Promise<string>;
  /** Creates the check run, or updates the one already on this commit; returns its URL */
  setCheck(
    sha: string,
    state: { status: 'queued' | 'in_progress' } | { status: 'completed'; conclusion: 'success' | 'neutral' | 'failure' },
    output: CheckOutput,
    detailsUrl?: string,
  ): Promise<string>;
}

/** GitHubApi backed by an installation Octokit from @octokit/app. */
export function octokitApi(octokit: Octokit, owner: string, repo: string): GitHubApi {
  const r = { owner, repo };
  return {
    async findOpenPr(sha) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
        ...r,
        commit_sha: sha,
      });
      const pr = data.find((p) => p.state === 'open' && p.head.sha === sha) ?? data.find((p) => p.state === 'open');
      return pr && { number: pr.number, title: pr.title };
    },

    async changedFiles(prNumber) {
      const files: string[] = [];
      // 3000 files is GitHub's own cap for this endpoint.
      for (let page = 1; page <= 30; page++) {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
          ...r,
          pull_number: prNumber,
          per_page: 100,
          page,
        });
        files.push(...data.filter((f) => f.status !== 'removed').map((f) => f.filename));
        if (data.length < 100) break;
      }
      return files;
    },

    async readFile(path, ref) {
      try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { ...r, path, ref });
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return undefined;
        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (err) {
        if (isStatus(err, 404)) return undefined;
        throw err;
      }
    },

    async productionUrl() {
      const { data: deployments } = await octokit.request('GET /repos/{owner}/{repo}/deployments', {
        ...r,
        environment: 'Production',
        per_page: 10,
      });
      for (const d of deployments) {
        const { data: statuses } = await octokit.request(
          'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
          { ...r, deployment_id: Number(d.id), per_page: 1 },
        );
        const latest = statuses[0];
        if (latest?.state === 'success' && latest.environment_url) return latest.environment_url;
      }
      return undefined;
    },

    async upsertComment(prNumber, body) {
      for (let page = 1; page <= 10; page++) {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          ...r,
          issue_number: prNumber,
          per_page: 100,
          page,
        });
        const mine = data.find((c) => c.body?.startsWith(COMMENT_MARKER));
        if (mine) {
          const { data: updated } = await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            ...r,
            comment_id: mine.id,
            body,
          });
          return updated.html_url;
        }
        if (data.length < 100) break;
      }
      const { data: created } = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        ...r,
        issue_number: prNumber,
        body,
      });
      return created.html_url;
    },

    async setCheck(sha, state, output, detailsUrl) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        ...r,
        ref: sha,
        check_name: CHECK_NAME,
        filter: 'latest',
      });
      const body = {
        ...state,
        output: { title: output.title, summary: truncate(output.summary, 65_000) },
        ...(detailsUrl ? { details_url: detailsUrl } : {}),
      };
      const existing = data.check_runs[0];
      if (existing) {
        const { data: updated } = await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
          ...r,
          check_run_id: existing.id,
          ...body,
        });
        return updated.html_url ?? '';
      }
      const { data: created } = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
        ...r,
        name: CHECK_NAME,
        head_sha: sha,
        ...body,
      });
      return created.html_url ?? '';
    },
  };
}

function isStatus(err: unknown, status: number): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && err.status === status;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 20)}\n\n…(truncated)` : text;
}
