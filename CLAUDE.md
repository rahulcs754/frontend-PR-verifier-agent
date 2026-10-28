# PreviewPilot — frontend PR verifier agent

For each PR, open the preview deploy and production side by side in a real browser (Playwright), find UI that broke, and post one short PR comment.

Full context: [docs/project-instructions.md](docs/project-instructions.md) and [docs/mvp-plan.md](docs/mvp-plan.md). Read them before starting work.

## Stack
- TypeScript, ESM, Node 22, strict mode
- Playwright (Chromium), pixelmatch + pngjs for image diffs
- GitHub Actions for CI and PR comments
- Later: Claude API for plain-English summaries of visual diffs

## Code layout (planned)
- `src/types.ts`: config and result types
- `src/config.ts`: defaults and config loading
- `src/capture.ts`: opens a page and collects errors, broken images, overflow and a screenshot
- `src/diff.ts`: pixel diff
- `src/verify.ts`: runs base and preview and compares them
- `src/report.ts`: Markdown report for the PR comment
- `src/cli.ts`: CLI entry point (`pr-verify --base <url> --preview <url> --routes /,/pricing`)

## Rules
- Only report issues that are new in the preview. If something is also broken on production, don't flag it.
- Hard breakages (JS exceptions, broken images, HTTP errors, horizontal overflow) are `fail`. Visual changes, console errors and slow loads are `warn`.
- Keep screenshots stable: disable animations, and mask dynamic content.
- Small, typed, well-named modules. Add unit tests (`node --test` + tsx) for pure logic such as compare and report.
- Work on a feature branch and open a PR. Don't push straight to `main`.
- Reply to the user in short, simple English.
