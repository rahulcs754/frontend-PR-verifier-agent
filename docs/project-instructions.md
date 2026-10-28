# PreviewPilot — project instructions

**What it is:** A frontend PR verifier agent. For each PR it opens the preview deploy and production side by side in a real browser (Playwright), finds UI that broke, and posts one short comment on the PR.

**Goal:** A portfolio project and possible product for a senior React/Next.js dev. It should look clean, be well typed, and be useful on real Next.js/Vercel repos.

**Stack:** TypeScript (ESM, Node 22), Playwright (Chromium), pixelmatch + pngjs, GitHub Actions. Later: Claude API for plain-English diff summaries.

**MVP (week 1–2):**
1. CLI: `pr-verify --base <prod-url> --preview <preview-url> --routes /,/pricing` (or a JSON config file)
2. For each route, on desktop (1280x800) and mobile (390x844):
   - full-page screenshots plus a pixel diff
   - new JS exceptions and console errors (only ones not on prod)
   - failed requests (4xx/5xx), broken images, horizontal overflow
   - load time much slower than prod
3. Output: report.md (the PR comment), report.json, and diff images
4. Exit code 1 on hard failures; `--strict` also fails on warnings
5. GitHub Action that runs when the Vercel/Netlify preview is ready and creates or updates one PR comment

**v2 ideas:** Claude reviews the diff images and explains the change; auto-find routes from the Next.js app/ folder; login support (storage state); masking dynamic content; hosted GitHub App.

**Code layout (draft already written, compiles, not tested yet):**
- src/types.ts: config and result types
- src/config.ts: defaults and config loading
- src/capture.ts: opens the page and collects errors, broken images, overflow and a screenshot
- src/diff.ts: pixel diff (pads images that have different heights)
- src/verify.ts: runs base and preview in parallel and compares them
- src/report.ts: Markdown report for the PR comment
- src/cli.ts: CLI entry point

**Next steps:** push the draft to the GitHub repo, test it on a sample site, add unit tests and the GitHub Action.

**Working style:** short, simple English replies. Push to GitHub only after the user shares the repo link.
