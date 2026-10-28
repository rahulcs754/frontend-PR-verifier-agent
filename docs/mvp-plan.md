# PR Verifier (working name: pr-verify) — MVP plan

**What it does:** For every PR, opens the preview deploy and production in a real browser (Playwright), compares them, and posts a short report on the PR showing what broke.

## MVP scope (week 1–2)
1. CLI in TypeScript: `pr-verify --base <prod-url> --preview <preview-url> --routes /,/pricing`
2. Per route and per viewport (desktop + mobile):
   - Full-page screenshots + pixel diff (pixelmatch)
   - New JS exceptions and console errors (only ones not on prod)
   - Failed network requests (4xx/5xx)
   - Broken images, horizontal overflow (mobile layout breaks)
   - Load time much slower than prod
3. Markdown report (PR comment) + JSON report + diff images
4. GitHub Action: runs when Vercel/Netlify preview is ready, posts/updates one PR comment

## Later (v2)
- AI step: Claude looks at the diff images and explains in plain words what changed and if it looks like a bug
- Auto-discover routes from Next.js app/ folder
- Login support (storage state) and masking dynamic content
- Hosted GitHub App version (product)

## Status
A first draft of the CLI core was already written before the "wait for repo" instruction (src/ here). It type-checks but is not tested yet. Keep or throw away when the repo is ready.
