#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildConfig, ConfigError, parseList, readConfigFile, type FileConfig } from './config.ts';
import { writeReportFiles } from './report.ts';
import { DEFAULT_MODEL, summarizeReport } from './summarize.ts';
import type { Report, RouteResult } from './types.ts';
import { verify } from './verify.ts';

const HELP = `pr-verify: compare a preview deploy with production in a real browser.

Usage:
  pr-verify --base <prod-url> --preview <preview-url> [--routes /,/pricing] [options]

Options:
  --base <url>             Production (or main branch) URL
  --preview <url>          Preview deploy URL
  --routes <list>          Comma-separated paths (default: /)
  --config <file>          JSON config file (flags win over the file)
  --viewports <list>       desktop, mobile or WIDTHxHEIGHT (default: desktop,mobile)
  --out <dir>              Output folder (default: pr-verify-report)
  --mask <list>            CSS selectors to hide in screenshots
  --diff-threshold <n>     Share of changed pixels to report, 0..1 (default: 0.002)
  --timeout <ms>           Page load timeout (default: 30000)
  --artifact-url <url>     Link to screenshots, shown in the PR comment
  --strict                 Exit 1 on warnings too
  --no-ai                  Skip the Claude review even if ANTHROPIC_API_KEY is set
  --ai-model <id>          Claude model for the review (default: ${DEFAULT_MODEL})
  -h, --help               Show this help

Env:
  VERCEL_AUTOMATION_BYPASS_SECRET   Sent to the preview only, to pass Vercel Deployment Protection
  ANTHROPIC_API_KEY                 Turns on Claude's plain-English review of the screenshots

Exit codes: 0 no new breakages, 1 breakages (or warnings with --strict), 2 bad input or crash.`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      preview: { type: 'string' },
      routes: { type: 'string' },
      config: { type: 'string' },
      viewports: { type: 'string' },
      out: { type: 'string' },
      mask: { type: 'string' },
      'diff-threshold': { type: 'string' },
      timeout: { type: 'string' },
      'artifact-url': { type: 'string' },
      strict: { type: 'boolean' },
      'no-ai': { type: 'boolean' },
      'ai-model': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const file = values.config ? await readConfigFile(values.config) : {};
  const flags: FileConfig = {
    base: values.base,
    preview: values.preview,
    routes: values.routes ? parseList(values.routes) : undefined,
    viewports: values.viewports ? parseList(values.viewports) : undefined,
    outDir: values.out,
    mask: values.mask ? parseList(values.mask) : undefined,
    diffThreshold: toNumber(values['diff-threshold'], '--diff-threshold'),
    timeoutMs: toNumber(values.timeout, '--timeout'),
    strict: values.strict,
    previewHeaders: bypassHeaders(file.previewHeaders),
  };
  const config = buildConfig(file, flags);

  console.log(`Base:    ${config.base}`);
  console.log(`Preview: ${config.preview}`);
  console.log(`Checking ${config.routes.length} route(s) x ${config.viewports.length} viewport(s)...\n`);

  const report = await verify(config, { onResult: printResult });
  if (!values['no-ai'] && process.env.ANTHROPIC_API_KEY) {
    report.ai = await reviewWithClaude(report, values['ai-model']);
  }

  const outDir = resolve(config.outDir);
  await writeReportFiles(report, outDir, { artifactUrl: values['artifact-url'] });

  printSummary(report, outDir);
  const failed = report.summary.status === 'fail' || (config.strict && report.summary.status === 'warn');
  return failed ? 1 : 0;
}

/** The Claude review is a bonus: if it fails, the report still goes out. */
async function reviewWithClaude(report: Report, model: string | undefined) {
  console.log('\nAsking Claude to review the screenshots...');
  try {
    const ai = await summarizeReport(report, { model });
    console.log(ai ? `Claude: ${ai.verdict}. ${ai.summary}` : 'Claude: nothing to review.');
    return ai;
  } catch (err) {
    console.warn(`Claude review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function bypassHeaders(fromFile: Record<string, string> | undefined): Record<string, string> | undefined {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return fromFile;
  return {
    ...fromFile,
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  };
}

function toNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new ConfigError(`${flag} must be a number, got "${value}"`);
  return n;
}

function printResult(r: RouteResult): void {
  const icon = { pass: '✓', warn: '!', fail: '✗' }[r.status];
  console.log(`${icon} ${r.route} [${r.viewport}]`);
  for (const issue of r.issues) console.log(`    ${issue.severity.padEnd(4)}  ${issue.message}`);
}

function printSummary(report: Report, outDir: string): void {
  const { fail, warn, status } = report.summary;
  console.log(`\n${status.toUpperCase()}: ${fail} fail, ${warn} warn`);
  console.log(`Report: ${join(outDir, 'report.md')}`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof ConfigError || (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))) {
      console.error(`Error: ${err.message}\n\nRun pr-verify --help for usage.`);
    } else {
      console.error(err);
    }
    process.exitCode = 2;
  },
);
