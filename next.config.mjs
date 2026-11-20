import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the dev badge clear of the sidebar's profile card.
  devIndicators: { position: 'bottom-right' },
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  // /tatva/* -> server/ /api/* is done in proxy.ts (it adds the server key).
  turbopack: {
    root: rootDir,
  },
  experimental: {
    // Local dev: uploads can go through the /tatva proxy (server limit: 25 MB).
    proxyClientMaxBodySize: '26mb',
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
};

export default nextConfig;
