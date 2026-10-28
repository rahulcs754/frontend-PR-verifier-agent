import Link from 'next/link';
import { RunBadge, VerdictBadge } from '@/components/badges';
import { ago } from '@/lib/format';
import { listRuns } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  const all = await listRuns();
  const runs = repo ? all.filter((r) => r.repo === repo) : all;
  const repos = [...new Set(all.map((r) => r.repo))].sort();

  const done = runs.filter((r) => r.status === 'done' && r.summary);
  const broken = done.filter((r) => r.summary!.status === 'fail').length;
  const warned = done.filter((r) => r.summary!.status === 'warn').length;

  return (
    <main>
      <h1>Runs</h1>
      <p className="muted">Each run compares a PR&apos;s preview deploy with production in a real browser.</p>

      <section className="stats">
        <div className="card stat">
          <b>{runs.length}</b>
          <span className="muted small">runs</span>
        </div>
        <div className="card stat">
          <b style={{ color: 'var(--fail)' }}>{broken}</b>
          <span className="muted small">found breakages</span>
        </div>
        <div className="card stat">
          <b style={{ color: 'var(--warn)' }}>{warned}</b>
          <span className="muted small">warnings only</span>
        </div>
        <div className="card stat">
          <b style={{ color: 'var(--pass)' }}>{done.length - broken - warned}</b>
          <span className="muted small">clean</span>
        </div>
      </section>

      {repos.length > 1 && (
        <nav className="filters" aria-label="Filter by repo">
          <Link className="chip" href="/" aria-current={!repo}>
            All repos
          </Link>
          {repos.map((r) => (
            <Link key={r} className="chip" href={`/?repo=${encodeURIComponent(r)}`} aria-current={repo === r}>
              {r}
            </Link>
          ))}
        </nav>
      )}

      {runs.length === 0 ? (
        <div className="card empty">
          <p>No runs yet.</p>
          <p className="muted small">
            Runs show up here once the GitHub App checks a PR preview. Set <code>RUNS_DIR</code> to the same folder
            the app writes to.
          </p>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Pull request</th>
                <th>Repo</th>
                <th>Issues</th>
                <th>Claude</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <RunBadge run={run} />
                  </td>
                  <td className="title">
                    <Link href={`/runs/${run.id}`}>
                      #{run.prNumber} {run.prTitle ?? ''}
                    </Link>
                    <div className="muted small">
                      <code>{run.sha.slice(0, 7)}</code> · {run.routes.length} route{run.routes.length === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className="small">{run.repo}</td>
                  <td className="small">
                    {run.summary ? (
                      <>
                        <span style={{ color: 'var(--fail)' }}>{run.summary.fail} fail</span> ·{' '}
                        <span style={{ color: 'var(--warn)' }}>{run.summary.warn} warn</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <VerdictBadge verdict={run.verdict} />
                  </td>
                  <td className="small muted" title={run.createdAt}>
                    {ago(run.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
