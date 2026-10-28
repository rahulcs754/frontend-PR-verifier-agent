import type { Run, Status, Verdict } from '@/lib/runs';

const STATUS_LABEL: Record<Status, string> = { pass: 'Pass', warn: 'Warnings', fail: 'Broken' };

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function RunBadge({ run }: { run: Run }) {
  if (run.status === 'error') return <span className="badge fail">Error</span>;
  if (run.status !== 'done' || !run.summary) return <span className="badge info">Running</span>;
  return <StatusBadge status={run.summary.status} />;
}

const VERDICT: Record<Verdict, { label: string; tone: Status }> = {
  'looks-good': { label: 'Looks intended', tone: 'pass' },
  'needs-review': { label: 'Needs a look', tone: 'warn' },
  'likely-broken': { label: 'Looks broken', tone: 'fail' },
};

export function VerdictBadge({ verdict }: { verdict?: Verdict }) {
  if (!verdict) return <span className="muted">—</span>;
  const v = VERDICT[verdict];
  return <span className={`badge ${v.tone}`}>{v.label}</span>;
}
