/**
 * Creates a real run from the test fixture sites, so the dashboard has
 * something to show locally: npm run seed  (then: cd dashboard && npm run dev)
 */
import { join } from 'node:path';
import { buildConfig } from '../src/config.ts';
import { writeReportFiles } from '../src/report.ts';
import { newRunId, RunStore, type RunRecord } from '../src/store.ts';
import { summarizeReport } from '../src/summarize.ts';
import { verify } from '../src/verify.ts';
import { serveDir } from '../test/helpers/static-server.ts';

const fixtures = join(import.meta.dirname, '..', 'test', 'fixtures');
const store = new RunStore(process.env.RUNS_DIR ?? 'runs');
const base = await serveDir(join(fixtures, 'base'));
const preview = await serveDir(join(fixtures, 'preview'));

try {
  const sha = Math.random().toString(16).slice(2).padEnd(40, '0');
  const run: RunRecord = {
    id: newRunId('demo/next-app', 42, sha),
    repo: 'demo/next-app',
    prNumber: 42,
    prTitle: 'Demo: new hero and logo',
    sha,
    baseUrl: base.url,
    previewUrl: preview.url,
    routes: ['/', '/about'],
    status: 'running',
    createdAt: new Date().toISOString(),
  };
  const config = buildConfig({}, { base: base.url, preview: preview.url, routes: run.routes, outDir: store.dirFor(run.id) });
  const report = await verify(config);
  if (process.env.ANTHROPIC_API_KEY) report.ai = await summarizeReport(report);
  await writeReportFiles(report, config.outDir);
  await store.save({ ...run, status: 'done', summary: report.summary, verdict: report.ai?.verdict, finishedAt: new Date().toISOString() });
  console.log(`Saved run ${run.id} in ${store.root}`);
} finally {
  await Promise.all([base.close(), preview.close()]);
}
