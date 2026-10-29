/**
 * Maps changed files in a Next.js App Router project to the routes they render.
 *
 * - app/pricing/page.tsx        -> /pricing
 * - src/app/(marketing)/page.tsx -> /           (route groups are dropped)
 * - app/blog/layout.tsx         -> /blog        (a layout affects its route)
 * - app/blog/[slug]/page.tsx    -> skipped      (needs a real slug; list one in config)
 * - app/@modal/..., app/api/... -> skipped
 */
export function routesFromChangedFiles(files: string[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    const route = routeForFile(file);
    if (route) routes.add(route);
  }
  return [...routes];
}

const ROUTE_FILE = /^(?:.*\/)?app\/(?:(.*)\/)?(?:page|layout|template|loading|error|not-found)\.(?:tsx|ts|jsx|js|mdx)$/;

export function routeForFile(file: string): string | undefined {
  const match = ROUTE_FILE.exec(file);
  if (!match) return undefined;
  const segments = (match[1] ?? '').split('/').filter(Boolean);
  const kept: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith('(') && seg.endsWith(')')) continue; // route group
    if (seg.startsWith('@') || seg.startsWith('_')) return undefined; // parallel route slot or private folder
    if (seg.startsWith('[') || seg.startsWith('(.')) return undefined; // dynamic or intercepting
    if (seg === 'api') return undefined;
    kept.push(seg);
  }
  return '/' + kept.join('/');
}

/**
 * Routes to check for a PR: the configured routes (always), plus pages the PR
 * touched. Capped so a huge PR doesn't run for an hour.
 */
export function pickRoutes(configured: string[], changedFiles: string[], max: number): string[] {
  const all = new Set(configured.length ? configured : ['/']);
  for (const r of routesFromChangedFiles(changedFiles)) all.add(r);
  return [...all].slice(0, max);
}
