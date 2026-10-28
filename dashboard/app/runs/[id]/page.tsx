import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RunBadge, StatusBadge, VerdictBadge } from '@/components/badges';
import { ago, ms, percent, shortUrl } from '@/lib/format';
import { getReport, getRun, imageUrl, type RouteResult } from '@/lib/runs';

export const dynamic = 'force-dynamic';

const RISK = { low: 'pass', medium: 'warn', high: 'fail' } as const;

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const report = await getReport(id);
  const prUrl = `https://github.com/${run.repo}/pull/${run.prNumber}`;

  return (
    <main>
      <Link href="/" className="small">
        ← All runs
      </Link>
      <h1>
        <RunBadge run={run} /> #{run.prNumber} {run.prTitle}
      </h1>
      <div className="meta muted">
        <span>{run.repo}</span>
        <span>
          commit <code>{run.sha.slice(0, 7)}</code>
        </span>
        <span title={run.createdAt}>{ago(run.createdAt)}</span>
        {report && <span>took {ms(report.durationMs)}</span>}
      </div>
      <div className="meta">
        <a href={prUrl}>Pull request</a>
        {run.commentUrl && <a href={run.commentUrl}>PR comment</a>}
        {run.checkRunUrl && <a href={run.checkRunUrl}>Check run</a>}
        <a href={run.previewUrl}>Preview: {shortUrl(run.previewUrl)}</a>
        <a href={run.baseUrl}>Base: {shortUrl(run.baseUrl)}</a>
      </div>

      {run.status === 'error' && (
        <div className="card ai">
          <h2>The run did not finish</h2>
          <p>
            <code>{run.error}</code>
          </p>
        </div>
      )}
      {run.status === 'running' && (
        <div className="card ai">
          <p>This run is still going. Refresh in a minute.</p>
        </div>
      )}

      {report?.ai && (
        <section className="card ai">
          <h2>
            Claude&apos;s review <VerdictBadge verdict={report.ai.verdict} />
          </h2>
          <p>{report.ai.summary}</p>
          {report.ai.changes.length > 0 && (
            <ul>
              {report.ai.changes.map((c, i) => (
                <li key={i}>
                  <span className={`badge ${RISK[c.risk]}`}>{c.risk}</span> <code>{c.route}</code> · {c.viewport}:{' '}
                  {c.description}
                </li>
              ))}
            </ul>
          )}
          {report.ai.risks.length > 0 && (
            <>
              <b>Check by hand</b>
              <ul>
                {report.ai.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">Written by {report.ai.model} from the screenshots. It can be wrong.</p>
        </section>
      )}

      {report && (
        <>
          <h2>
            Pages <span className="muted small">({report.results.length} checked)</span>
          </h2>
          {sortResults(report.results).map((r) => (
            <ResultCard key={`${r.route}-${r.viewport}`} runId={run.id} result={r} />
          ))}
        </>
      )}
    </main>
  );
}

/** Broken first, then warnings, then clean. */
function sortResults(results: RouteResult[]): RouteResult[] {
  const rank = { fail: 0, warn: 1, pass: 2 };
  return [...results].sort((a, b) => rank[a.status] - rank[b.status]);
}

function ResultCard({ runId, result: r }: { runId: string; result: RouteResult }) {
  const shots = [
    { label: 'Base (production)', src: imageUrl(runId, r.base.screenshotPath) },
    { label: 'Preview (this PR)', src: imageUrl(runId, r.preview.screenshotPath) },
    { label: 'Diff (red = changed)', src: imageUrl(runId, r.diff?.path) },
  ];
  return (
    <article className="card result">
      <header>
        <StatusBadge status={r.status} />
        <code>{r.route}</code>
        <span className="muted small">{r.viewport}</span>
        <span className="grow" />
        <span className="small muted">
          {r.diff ? (r.diff.diffPixels ? `${percent(r.diff.ratio)} changed` : 'no visual change') : 'no diff'} ·{' '}
          {r.preview.navigationError ? 'did not load' : `${ms(r.preview.loadMs)} vs ${ms(r.base.loadMs)}`}
        </span>
      </header>
      {r.issues.length > 0 && (
        <ul className="issues">
          {r.issues.map((issue, i) => (
            <li key={i}>
              <span className={`tag ${issue.severity}`}>{issue.severity === 'fail' ? 'FAIL' : 'WARN'}</span>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="shots">
        {shots.map((s) => (
          <figure key={s.label} className="shot" style={{ margin: 0 }}>
            <figcaption>{s.label}</figcaption>
            {s.src ? (
              <a href={s.src} target="_blank" rel="noreferrer">
                {/* Full-page screenshots of unknown size; next/image would need fixed dimensions. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={`${s.label} of ${r.route} on ${r.viewport}`} loading="lazy" />
              </a>
            ) : (
              <div className="card none muted">{s.label.startsWith('Diff') ? 'No changes' : 'No screenshot'}</div>
            )}
          </figure>
        ))}
      </div>
    </article>
  );
}
