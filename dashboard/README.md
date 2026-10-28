# PreviewPilot dashboard

A small Next.js App Router app that lists past PreviewPilot runs and shows each one: Claude's review, the issues per page and viewport, and the base, preview and diff screenshots side by side.

It reads the runs the GitHub App saves to disk (`RUNS_DIR`, default `../runs`). There is no database: each run is a folder with `run.json`, `report.json` and `images/`.

```bash
# from the repo root: make a demo run from the test fixtures
npm run seed

cd dashboard
npm install
npm run dev        # http://localhost:3000
```

In production, run it next to the GitHub App with the same volume (see `docker-compose.yml` in the repo root), and set `DASHBOARD_URL` on the app so PR comments and check runs link to the run page.

Pages:
- `/` all runs, newest first, with totals and a filter by repo
- `/runs/<id>` one run
- `/runs/<id>/images/<file>.png` screenshots (names are validated, nothing else on disk is served)

The dashboard has no login. Put it behind your own auth (Vercel password protection, Cloudflare Access, a VPN) if the screenshots are private.
