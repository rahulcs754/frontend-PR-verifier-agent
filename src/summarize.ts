import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { formatPercent } from './compare.ts';
import type { AiSummary, Report, RouteResult } from './types.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Claude scales big images down anyway; a tall full-page shot becomes unreadable. */
const MAX_IMAGE_HEIGHT = 1600;

const SummarySchema = z.object({
  verdict: z
    .enum(['looks-good', 'needs-review', 'likely-broken'])
    .describe('looks-good: only intended-looking changes. needs-review: unclear. likely-broken: a user would notice a bug.'),
  summary: z.string().describe('2-3 plain sentences for the PR author: what changed and whether it looks intended.'),
  changes: z
    .array(
      z.object({
        route: z.string(),
        viewport: z.string(),
        description: z.string().describe('What changed visually, in one sentence.'),
        risk: z.enum(['low', 'medium', 'high']),
      }),
    )
    .describe('One entry per page and viewport you looked at. Skip pages with nothing worth saying.'),
  risks: z.array(z.string()).describe('Things a reviewer should check by hand, most important first. Empty if none.'),
});

const SYSTEM = `You review frontend pull requests for a team that ships Next.js apps on Vercel.
For each page you get a screenshot of production (base) and of the PR's preview deploy, plus a diff image where changed pixels are red, and the automated checks that already ran.
Explain what changed visually in plain words, and judge whether it looks like an intended change or a bug: broken layout, overlapping or cut-off text, missing images or sections, wrong colors or spacing, content that disappeared.
The automated checks are reliable; do not repeat them as new findings, but use them to explain what you see.
Be short and concrete. Name the element ("the pricing table", "the header nav"), not pixel coordinates. If a screenshot is cropped, only judge the part you can see.`;

export interface SummarizeOptions {
  model?: string;
  /** How many page/viewport pairs to send screenshots for */
  maxPages?: number;
  client?: Anthropic;
}

/**
 * Asks Claude to explain the visual changes. Returns undefined when there is
 * nothing to explain or Claude declined.
 */
export async function summarizeReport(report: Report, opts: SummarizeOptions = {}): Promise<AiSummary | undefined> {
  const picked = pickForReview(report.results, opts.maxPages ?? 4);
  if (picked.length === 0) return undefined;

  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: describeRun(report, picked) }];

  for (const r of picked) {
    content.push({ type: 'text', text: `## ${r.route} (${r.viewport})\n${describeResult(r)}` });
    for (const [label, path] of [
      ['base (production)', r.base.screenshotPath],
      ['preview (this PR)', r.preview.screenshotPath],
      ['diff (red = changed)', r.diff?.path],
    ] as const) {
      if (!path) continue;
      const { data, cropped } = cropTop(await readFile(path), MAX_IMAGE_HEIGHT);
      content.push({ type: 'text', text: `${label}${cropped ? ' - cropped to the top of the page' : ''}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: data.toString('base64') } });
    }
  }

  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'medium', format: betaZodOutputFormat(SummarySchema) },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) return undefined;
  return { ...response.parsed_output, model: response.model };
}

/**
 * Pages worth a look: failing first, then by how much changed. Pages with no
 * visual change and no issues are skipped to save tokens.
 */
export function pickForReview(results: RouteResult[], max: number): RouteResult[] {
  const rank = { fail: 2, warn: 1, pass: 0 } as const;
  return results
    .filter((r) => r.preview.screenshotPath && ((r.diff?.diffPixels ?? 0) > 0 || r.issues.length > 0))
    .sort((a, b) => rank[b.status] - rank[a.status] || (b.diff?.ratio ?? 0) - (a.diff?.ratio ?? 0))
    .slice(0, max);
}

function describeRun(report: Report, picked: RouteResult[]): string {
  const skipped = report.results.length - picked.length;
  return [
    `Base: ${report.base}`,
    `Preview: ${report.preview}`,
    `Checked ${report.results.length} page/viewport pairs; showing the ${picked.length} with changes or issues` +
      (skipped > 0 ? ` (${skipped} others had no change or were left out).` : '.'),
    `Overall automated result: ${report.summary.status} (${report.summary.fail} fail, ${report.summary.warn} warn).`,
  ].join('\n');
}

export function describeResult(r: RouteResult): string {
  const lines = [`Automated result: ${r.status}`];
  if (r.diff) lines.push(`Pixels changed: ${formatPercent(r.diff.ratio)}${r.diff.sizeChanged ? ', page size changed' : ''}`);
  for (const issue of r.issues) lines.push(`- [${issue.severity}] ${issue.message}`);
  return lines.join('\n');
}

/** Keeps the top maxHeight px of a PNG. */
export function cropTop(buf: Buffer, maxHeight: number): { data: Buffer; cropped: boolean } {
  const img = PNG.sync.read(buf);
  if (img.height <= maxHeight) return { data: buf, cropped: false };
  const out = new PNG({ width: img.width, height: maxHeight });
  img.data.copy(out.data, 0, 0, img.width * maxHeight * 4);
  return { data: PNG.sync.write(out), cropped: true };
}
