# PreviewPilot (`pr-verify`)

For each PR, PreviewPilot opens the **preview deploy** and **production** side by side in a real browser (Playwright), finds UI that broke, and posts **one short PR comment**.

It only reports what is **new in the preview**. If something is already broken on production, the PR is not blamed for it.

## What it checks

For every route, on desktop (1280x800) and mobile (390x844):

| Check | Result |
| --- | --- |
| Page did not load, or returns 4xx/5xx | ❌ fail |
| New JS exceptions | ❌ fail |
| New broken images | ❌ fail |
| New failed requests (4xx/5xx/network) on your own domain | ❌ fail |
| Page scrolls sideways (horizontal overflow) | ❌ fail |
| New console errors | ⚠️ warn |
| Visual change (full-page pixel diff) | ⚠️ warn |
| Much slower load than production | ⚠️ warn |
| Failed third-party requests | ⚠️ warn |

Screenshots are made stable: animations and transitions are off, the caret is hidden, locale and timezone are fixed, and you can mask dynamic parts with CSS selectors.

## CLI

```bash
npm install
npx playwright install chromium
npm run build

node dist/cli.js --base https://your-app.com --preview https://your-app-git-feature.vercel.app --routes /,/pricing
```

Output goes to `pr-verify-report/`:

- `report.md`: the PR comment
- `report.json`: full results
- `images/`: base, preview and diff screenshots

Exit code: `0` no new breakages, `1` breakages (or warnings with `--strict`), `2` bad input or crash.

Run `node dist/cli.js --help` for all options. You can also put options in a JSON file and pass `--config pr-verify.config.json` (see [examples/pr-verify.config.json](examples/pr-verify.config.json)). Flags win over the file.

### Claude review

Set `ANTHROPIC_API_KEY` and Claude looks at the base, preview and diff screenshots of the pages that changed (up to 4, failing pages first). It adds a short review at the top of the PR comment:

- a verdict: looks intended, needs a human look, or looks broken
- one line per changed page, with a risk level
- what a reviewer should check by hand

It uses `claude-opus-5-5` by default (`--ai-model` to change it) with server-side fallbacks on. If the call fails, the report still goes out without it. `--no-ai` turns it off.

### Protected Vercel previews

If your previews use Vercel Deployment Protection, create a "Protection Bypass for Automation" secret in Vercel and set `VERCEL_AUTOMATION_BYPASS_SECRET`. It is sent only to the preview.

## GitHub Action

Vercel sends a `deployment_status` event when a preview is ready. Copy [examples/vercel-preview.yml](examples/vercel-preview.yml) to `.github/workflows/` in your app repo and set:

- repo variable `PR_VERIFY_BASE_URL`: your production URL
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` (only if previews are protected)
- secret `ANTHROPIC_API_KEY` (optional, for the Claude review)

The action runs the checks, uploads screenshots as a build artifact, and creates or updates a single PR comment.

## GitHub App

Prefer not to add a workflow to every repo? Run PreviewPilot as a GitHub App. It listens for PR and Vercel deployment events, checks the configured routes plus the pages the PR changed, posts the comment, and sets a `PreviewPilot` check run. See [docs/github-app.md](docs/github-app.md).

## Dashboard

`dashboard/` is a Next.js App Router app that lists past runs and shows each one with Claude's review, the issues, and base/preview/diff screenshots side by side. It reads the runs the GitHub App saves. `docker-compose.yml` runs both together. See [dashboard/README.md](dashboard/README.md).

## Dogfooding on this repo

`.github/workflows/preview-pilot.yml` runs PreviewPilot on this repo's own demo app (`examples/demo-app`) every time Vercel reports a ready preview. To turn it on:

1. Import this repo into Vercel (no settings needed: the root `vercel.json` builds `examples/demo-app`), and deploy it to Production once.
2. Optional secrets: `VERCEL_AUTOMATION_BYPASS_SECRET` (if previews are protected) and `ANTHROPIC_API_KEY` (for the Claude review). Optional variable: `PR_VERIFY_BASE_URL` (otherwise the latest Production deployment is used).
3. Open a PR that changes the demo app. The workflow comments on it.

## Development

```bash
npm test           # unit tests + a real-browser test against local fixture sites
npm run typecheck
npm run verify -- --base ... --preview ...   # run from source with tsx
npm run seed       # save a demo run from the fixtures, for the dashboard
```

Code layout:

- `src/types.ts`: config and result types
- `src/config.ts`: defaults, config file and flag merging
- `src/capture.ts`: opens a page and collects errors, broken images, overflow and a screenshot
- `src/diff.ts`: pixel diff (pads images with different heights)
- `src/compare.ts`: decides which issues are new in the preview
- `src/verify.ts`: runs base and preview side by side for each route and viewport
- `src/report.ts`: Markdown PR comment and JSON report
- `src/summarize.ts`: Claude review of the screenshots
- `src/cli.ts`: CLI entry point
- `src/store.ts`: saved runs on disk (shared by the app and dashboard)
- `src/app/`: GitHub App: webhook server, run flow, routes from changed files, GitHub calls

## Roadmap

- Login support (storage state)
- Dashboard login and run retention
