#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { App } from '@octokit/app';
import { createNodeMiddleware } from '@octokit/webhooks';
import { RunStore } from '../store.ts';
import { summarizeReport } from '../summarize.ts';
import { verify } from '../verify.ts';
import { octokitApi } from './github.ts';
import { SerialQueue } from './queue.ts';
import { isReadyPreview, markWaiting, runForDeployment, type RunDeps } from './run.ts';

/**
 * PreviewPilot GitHub App server.
 *
 * Env:
 *   GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET,
 *   GITHUB_PRIVATE_KEY (PEM) or GITHUB_PRIVATE_KEY_PATH
 *   PORT (default 3001), RUNS_DIR (default ./runs), DASHBOARD_URL (optional)
 *   VERCEL_AUTOMATION_BYPASS_SECRET, ANTHROPIC_API_KEY, PR_VERIFY_AI_MODEL (optional)
 */
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}. See docs/github-app.md.`);
  return value;
}

function privateKey(): string {
  if (process.env.GITHUB_PRIVATE_KEY) return process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  return readFileSync(env('GITHUB_PRIVATE_KEY_PATH'), 'utf8');
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const app = new App({
  appId: env('GITHUB_APP_ID'),
  privateKey: privateKey(),
  webhooks: { secret: env('GITHUB_WEBHOOK_SECRET') },
});

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const aiModel = process.env.PR_VERIFY_AI_MODEL;
const deps: RunDeps = {
  store: new RunStore(process.env.RUNS_DIR ?? 'runs'),
  verify: (config) => verify(config),
  summarize: process.env.ANTHROPIC_API_KEY ? (report) => summarizeReport(report, { model: aiModel }) : undefined,
  dashboardUrl: process.env.DASHBOARD_URL,
  previewHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
  log,
};
const queue = new SerialQueue((err) => log(`job failed: ${err instanceof Error ? err.stack : String(err)}`));

app.webhooks.on(['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'], async ({ octokit, payload }) => {
  const [owner, repo] = [payload.repository.owner.login, payload.repository.name];
  await markWaiting(octokitApi(octokit, owner, repo), payload.pull_request.head.sha);
});

app.webhooks.on('deployment_status', async ({ octokit, payload }) => {
  const event = {
    repo: payload.repository.full_name,
    sha: payload.deployment.sha,
    environment: payload.deployment.environment,
    state: payload.deployment_status.state,
    environmentUrl: payload.deployment_status.environment_url,
  };
  if (!isReadyPreview(event)) return;
  const gh = octokitApi(octokit, payload.repository.owner.login, payload.repository.name);
  // Answer the webhook right away; the browser run takes a while.
  const added = queue.push(`${event.repo}@${event.sha}@${event.environmentUrl}`, () => runForDeployment(gh, event, deps));
  log(`${event.repo}@${event.sha.slice(0, 7)}: ${added ? 'queued' : 'already queued'} (${queue.size} in queue)`);
});

app.webhooks.onError((err) => log(`webhook error: ${err.message}`));

const WEBHOOK_PATH = '/api/github/webhooks';
// Only the webhooks part of @octokit/app: the OAuth routes need a client secret we don't use.
const middleware = createNodeMiddleware(app.webhooks, { path: WEBHOOK_PATH });
const port = Number(process.env.PORT ?? 3001);

createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queue: queue.size }));
    return;
  }
  if (req.url?.split('?')[0] === WEBHOOK_PATH) {
    await middleware(req, res);
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => log(`PreviewPilot app listening on :${port} (webhooks at ${WEBHOOK_PATH})`));
