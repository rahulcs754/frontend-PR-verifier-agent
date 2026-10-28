import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Runs are read from disk at request time, so the server is self-contained for Docker.
  output: 'standalone',
  // The repo root has its own lockfile; this app is its own project.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
