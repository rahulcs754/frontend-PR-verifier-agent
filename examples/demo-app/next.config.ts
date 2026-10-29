import type { NextConfig } from 'next';

// Static export: the repo-root vercel.json serves examples/demo-app/out,
// so the Vercel project works without a custom Root Directory.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
