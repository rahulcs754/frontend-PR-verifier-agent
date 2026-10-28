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

### Protected Vercel previews

If your previews use Vercel Deployment Protection, create a "Protection Bypass for Automation" secret in Vercel and set `VERCEL_AUTOMATION_BYPASS_SECRET`. It is sent only to the preview.

## GitHub Action

Vercel sends a `deployment_status` event when a preview is ready. Copy [examples/vercel-preview.yml](examples/vercel-preview.yml) to `.github/workflows/` in your app repo and set:

- repo variable `PR_VERIFY_BASE_URL`: your production URL
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` (only if previews are protected)

The action runs the checks, uploads screenshots as a build artifact, and creates or updates a single PR comment.

## Development

```bash
npm test           # unit tests + a real-browser test against local fixture sites
npm run typecheck
npm run verify -- --base ... --preview ...   # run from source with tsx
```

Code layout:

- `src/types.ts`: config and result types
- `src/config.ts`: defaults, config file and flag merging
- `src/capture.ts`: opens a page and collects errors, broken images, overflow and a screenshot
- `src/diff.ts`: pixel diff (pads images with different heights)
- `src/compare.ts`: decides which issues are new in the preview
- `src/verify.ts`: runs base and preview side by side for each route and viewport
- `src/report.ts`: Markdown PR comment and JSON report
- `src/cli.ts`: CLI entry point

## Roadmap

- Claude explains the diff images in plain words and flags what looks like a bug
- Auto-find routes from the Next.js `app/` folder, and only check routes the PR touched
- Login support (storage state)
- Hosted GitHub App and a Next.js dashboard of past runs
