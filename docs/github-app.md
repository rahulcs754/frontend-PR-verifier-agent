# PreviewPilot GitHub App

The GitHub App does the same checks as the GitHub Action, but without adding a workflow to each repo. Install it once and every PR gets checked.

## How it works

1. **PR opened or new commits** → a `PreviewPilot` check shows up as "Waiting for the preview deploy".
2. **Vercel says the preview is ready** (`deployment_status` = success, not Production) → the app:
   - finds the open PR for that commit
   - reads `.github/pr-verify.json` at that commit (optional)
   - picks the production URL: `baseUrl` from the config, or the latest successful Production deployment
   - picks routes: the configured `routes` (default `/`) plus pages the PR changed (`app/**/page.tsx`, `layout.tsx` and so on; dynamic `[slug]` routes are skipped, so list a real URL for them in `routes`)
   - runs the checks, asks Claude for a review if `ANTHROPIC_API_KEY` is set
   - creates or updates one PR comment and completes the check run
3. Each run is saved in `RUNS_DIR` (run.json, report.json, report.md, images) for the dashboard.

Check run result: **failure** for breaking issues, **neutral** for warnings only (or if the tool itself crashed), **success** when nothing new broke. Set `"strict": true` in the repo config to fail on warnings.

Runs are processed one at a time, so load times are not skewed by parallel browsers.

## Set up

1. **Create the app.** Use [app.yml](../app.yml) as a manifest, or create it by hand in GitHub → Settings → Developer settings → GitHub Apps with:
   - Webhook URL: `https://<your-server>/api/github/webhooks`, and a webhook secret
   - Permissions: Checks (write), Contents (read), Deployments (read), Pull requests (write), Issues (write), Metadata (read)
   - Events: Pull request, Deployment status
2. **Download a private key** and note the App ID.
3. **Run the server** (needs Chromium, so use the Docker image or a machine with `npx playwright install --with-deps chromium`):

   ```bash
   docker build -t preview-pilot .
   docker run -p 3001:3001 -v pilot-data:/data \
     -e GITHUB_APP_ID=123456 \
     -e GITHUB_WEBHOOK_SECRET=... \
     -e GITHUB_PRIVATE_KEY="$(cat private-key.pem)" \
     -e ANTHROPIC_API_KEY=... \
     -e VERCEL_AUTOMATION_BYPASS_SECRET=... \
     -e DASHBOARD_URL=https://pilot.your-domain.com \
     preview-pilot
   ```

   For local testing, run `npm run app` and forward webhooks with [smee.io](https://smee.io) or `gh webhook forward`.
4. **Install the app** on your Next.js repos. Vercel's GitHub integration already sends deployment statuses, so nothing else is needed.

Health check: `GET /healthz`.

## Env

| Name | Needed | What |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | App ID |
| `GITHUB_WEBHOOK_SECRET` | yes | Webhook secret |
| `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_PATH` | yes | App private key (PEM, `\n` escapes are fine) |
| `PORT` | no | Default 3001 |
| `RUNS_DIR` | no | Where runs are saved. Default `./runs` |
| `DASHBOARD_URL` | no | Links the check and comment to the dashboard page of the run (see `dashboard/`) |
| `ANTHROPIC_API_KEY` | no | Turns on the Claude review |
| `PR_VERIFY_AI_MODEL` | no | Claude model, default `claude-opus-5-5` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | no | For protected previews; sent only to the preview |

## Repo config

`.github/pr-verify.json` in the app's repo. Every field is optional. See [examples/repo-config.json](../examples/repo-config.json).

| Field | Default | What |
| --- | --- | --- |
| `baseUrl` | latest Production deployment | URL to compare with |
| `routes` | `["/"]` | Always checked |
| `autoRoutes` | `true` | Also check pages the PR changed |
| `maxRoutes` | `10` | Cap per run |
| `viewports`, `mask`, `ignoreConsole`, `diffThreshold`, `strict`, ... | | Same as the CLI config |
