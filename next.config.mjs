import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  // The web app reads and writes through the Tatva server (server/, port 4000).
  // /tatva/* is proxied to its /api/*, so the browser needs no CORS or server URL.
  async rewrites() {
    const target = process.env.TATVA_SERVER_URL || 'http://localhost:4000';
    return [{ source: '/tatva/:path*', destination: `${target}/api/:path*` }];
  },
  turbopack: {
    root: rootDir,
  },
  experimental: {
    // Knowledge Base PDF uploads go through the /tatva proxy (server limit: 25 MB).
    proxyClientMaxBodySize: '26mb',
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
};

export default nextConfig;
