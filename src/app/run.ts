import { buildConfig } from '../config.ts';
import { formatMs } from '../compare.ts';
import { writeReportFiles } from '../report.ts';
import { newRunId, type RunRecord, type RunStore } from '../store.ts';
import type { AiSummary, Config, Report } from '../types.ts';
import type { CheckOutput, GitHubApi } from './github.ts';
import { parseRepoConfig, REPO_CONFIG_PATH } from './repo-config.ts';
import { pickRoutes } from './routes.ts';

export interface RunDeps {
  store: RunStore;
  /** Runs the browser checks. Injected so tests don't need a browser. */
  verify: (config: Config) => Promise<Report>;
  /** Claude review; left out when there is no API key */
  summarize?: (report: Report) => Promise<AiSummary | undefined>;
  /** Public URL of the dashboard, used for "details" links */
  dashboardUrl?: string;
  /** Extra headers for the preview (Vercel protection bypass) */
  previewHeaders?: Record<string, string>;
  log?: (msg: string) => void;
}

export interface DeploymentEvent {
  /** "owner/name" */
  repo: string;
  sha: string;
  /** deployment.environment, e.g. "Preview" or "Production" */
  environment: string;
  /** deployment_status.state */
  state: string;
  /** deployment_status.environment_url (the preview URL) */
  environmentUrl?: string | null;
}

/** Vercel names preview environments "Preview" (or "Preview – project" in monorepos). */
export function isReadyPreview(e: DeploymentEvent): boolean {
  return e.state === 'success' && !!e.environmentUrl && !/production/i.test(e.environment);
}

/** A PR was opened or got new commits: show a pending check until the preview is ready. */
export async function markWaiting(gh: GitHubApi, sha: string): Promise<void> {
  await gh.setCheck(sha, { status: 'queued' }, {
    title: 'Waiting for the preview deploy',
    summary: 'PreviewPilot starts when Vercel reports that the preview for this commit is ready.',
  });
}

/**
 * A preview deploy is ready: check it against production, comment on the PR,
 * complete the check run and save the run for the dashboard.
 */
export async function runForDeployment(
  gh: GitHubApi,
  event: DeploymentEvent,
  deps: RunDeps,
): Promise<RunRecord | undefined> {
  const log = deps.log ?? (() => {});
  if (!isReadyPreview(event)) return undefined;

  const pr = await gh.findOpenPr(event.sha);
  if (!pr) {
    log(`${event.repo}@${event.sha.slice(0, 7)}: no open PR, skipping`);
    return undefined;
  }

  const repoConfig = parseRepoConfig(await gh.readFile(REPO_CONFIG_PATH, event.sha));
  const baseUrl = repoConfig.baseUrl ?? (await gh.productionUrl());
  if (!baseUrl) {
    await gh.setCheck(event.sha, { status: 'completed', conclusion: 'neutral' }, {
      title: 'No production URL to compare with',
      summary: `Add \`"baseUrl": "https://your-site.com"\` to \`${REPO_CONFIG_PATH}\`, or deploy to Production once.`,
    });
    return undefined;
  }

  const configured = repoConfig.routes ?? ['/'];
  const routes =
    repoConfig.autoRoutes === false
      ? configured
      : pickRoutes(configured, await gh.changedFiles(pr.number), repoConfig.maxRoutes ?? 10);

  const run: RunRecord = {
    id: newRunId(event.repo, pr.number, event.sha),
    repo: event.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    sha: event.sha,
    baseUrl,
    previewUrl: event.environmentUrl!,
    routes,
    status: 'running',
    createdAt: new Date().toISOString(),
  };
  const detailsUrl = deps.dashboardUrl ? `${deps.dashboardUrl.replace(/\/$/, '')}/runs/${run.id}` : undefined;
  await deps.store.save(run);
  log(`${run.id}: checking ${routes.join(', ')} on ${run.previewUrl}`);

  try {
    run.checkRunUrl = await gh.setCheck(event.sha, { status: 'in_progress' }, {
      title: `Checking ${routes.length} page${routes.length === 1 ? '' : 's'}`,
      summary: `Comparing ${run.previewUrl} with ${baseUrl}.`,
    }, detailsUrl);

    const { autoRoutes: _a, maxRoutes: _m, baseUrl: _b, ...cliOptions } = repoConfig;
    const config = buildConfig(cliOptions, {
      base: baseUrl,
      preview: run.previewUrl,
      routes,
      outDir: deps.store.dirFor(run.id),
      previewHeaders: { ...repoConfig.previewHeaders, ...deps.previewHeaders },
    });

    const report = await deps.verify(config);
    if (deps.summarize) {
      report.ai = await deps.summarize(report).catch((err: unknown) => {
        log(`${run.id}: Claude review skipped: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      });
    }
    const markdown = await writeReportFiles(report, config.outDir, { artifactUrl: detailsUrl });

    run.commentUrl = await gh.upsertComment(pr.number, markdown);
    run.summary = report.summary;
    run.verdict = report.ai?.verdict;
    run.status = 'done';

    const failed = report.summary.status === 'fail' || (config.strict && report.summary.status === 'warn');
    await gh.setCheck(event.sha, {
      status: 'completed',
      conclusion: failed ? 'failure' : report.summary.status === 'warn' ? 'neutral' : 'success',
    }, checkOutput(report, markdown), detailsUrl);
  } catch (err) {
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    log(`${run.id}: error: ${run.error}`);
    // A crash in the tool should not block merging.
    await gh
      .setCheck(event.sha, { status: 'completed', conclusion: 'neutral' }, {
        title: 'PreviewPilot could not finish',
        summary: run.error,
      }, detailsUrl)
      .catch(() => {});
  } finally {
    run.finishedAt = new Date().toISOString();
    await deps.store.save(run);
  }
  return run;
}

function checkOutput(report: Report, markdown: string): CheckOutput {
  const { fail, warn, checked } = report.summary;
  const title =
    report.summary.status === 'pass'
      ? `No new issues on ${checked} page view${checked === 1 ? '' : 's'}`
      : [fail && `${fail} breaking`, warn && `${warn} warning${warn === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  return { title: `${title} (${formatMs(report.durationMs)})`, summary: markdown };
}
