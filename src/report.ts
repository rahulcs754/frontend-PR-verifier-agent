import { basename } from 'node:path';
import { formatMs, formatPercent } from './compare.ts';
import type { Issue, Report, RouteResult, Status } from './types.ts';

/** Hidden marker so the GitHub Action can find and update its own comment. */
export const COMMENT_MARKER = '<!-- pr-verify-report -->';

/** Keeps the PR comment short when many things break at once. */
const MAX_ISSUES_PER_ROW = 8;

export interface MarkdownOptions {
  /** Link to the CI run or artifact with screenshots and diff images */
  artifactUrl?: string;
}

const ICON: Record<Status, string> = { pass: '✅', warn: '⚠️', fail: '❌' };
const SEVERITY_ICON: Record<Issue['severity'], string> = { fail: '❌', warn: '⚠️' };

export function renderMarkdown(report: Report, opts: MarkdownOptions = {}): string {
  const { summary } = report;
  const lines: string[] = [COMMENT_MARKER, `## ${ICON[summary.status]} PreviewPilot: ${headline(report)}`, ''];

  lines.push(
    `Compared **preview** ${link(report.preview)} with **base** ${link(report.base)} ` +
      `on ${summary.checked} page${summary.checked === 1 ? '' : 's'} in ${formatMs(report.durationMs)}.`,
    '',
  );

  lines.push('| Page | Viewport | Result | Visual diff | Load (preview / base) |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of report.results) {
    lines.push(
      `| \`${r.route}\` | ${r.viewport} | ${ICON[r.status]} ${label(r)} | ${diffCell(r)} | ${loadCell(r)} |`,
    );
  }
  lines.push('');

  const withIssues = report.results.filter((r) => r.issues.length > 0);
  if (withIssues.length > 0) {
    lines.push('### What changed');
    lines.push('');
    for (const r of withIssues) {
      lines.push(`**\`${r.route}\` · ${r.viewport}**`);
      // Hard failures first, then warnings.
      const sorted = [...r.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fail' ? -1 : 1));
      for (const issue of sorted.slice(0, MAX_ISSUES_PER_ROW)) {
        lines.push(`- ${SEVERITY_ICON[issue.severity]} ${escapeMd(issue.message)}`);
      }
      if (sorted.length > MAX_ISSUES_PER_ROW) {
        lines.push(`- …and ${sorted.length - MAX_ISSUES_PER_ROW} more (see report.json)`);
      }
      lines.push('');
    }
  }

  const footer = ['Only issues that are new in the preview are listed.'];
  if (opts.artifactUrl) footer.push(`[Screenshots and diff images](${opts.artifactUrl})`);
  lines.push(`<sub>${footer.join(' · ')}</sub>`);

  return lines.join('\n') + '\n';
}

/** report.json without absolute local paths, so it is safe to upload and share. */
export function toJson(report: Report): string {
  const strip = (p?: string) => (p ? `images/${basename(p)}` : undefined);
  const clean: Report = {
    ...report,
    results: report.results.map((r) => ({
      ...r,
      base: { ...r.base, screenshotPath: strip(r.base.screenshotPath) },
      preview: { ...r.preview, screenshotPath: strip(r.preview.screenshotPath) },
      diff: r.diff && { ...r.diff, path: strip(r.diff.path) },
    })),
  };
  return JSON.stringify(clean, null, 2) + '\n';
}

function headline({ summary }: Report): string {
  if (summary.status === 'pass') return 'no new issues';
  const parts: string[] = [];
  if (summary.fail) parts.push(`${summary.fail} breaking issue${summary.fail === 1 ? '' : 's'}`);
  if (summary.warn) parts.push(`${summary.warn} warning${summary.warn === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function label(r: RouteResult): string {
  if (r.status === 'pass') return 'OK';
  const fails = r.issues.filter((i) => i.severity === 'fail').length;
  const warns = r.issues.length - fails;
  return [fails && `${fails} fail`, warns && `${warns} warn`].filter(Boolean).join(', ');
}

function diffCell(r: RouteResult): string {
  if (!r.diff) return 'n/a';
  if (r.diff.diffPixels === 0) return 'none';
  return formatPercent(r.diff.ratio) + (r.diff.sizeChanged ? ' (resized)' : '');
}

function loadCell(r: RouteResult): string {
  if (r.preview.navigationError) return 'did not load';
  return `${formatMs(r.preview.loadMs)} / ${formatMs(r.base.loadMs)}`;
}

function link(url: string): string {
  return `[${url.replace(/^https?:\/\//, '')}](${url})`;
}

/** Stops error text from breaking the Markdown (tables, HTML, mentions). */
export function escapeMd(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`)
    .replace(/@(?=\w)/g, '@​')
    .replace(/\r?\n/g, ' ');
}
