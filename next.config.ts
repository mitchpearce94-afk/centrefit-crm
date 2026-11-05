import type { NextConfig } from "next";

// Build identity baked into BOTH the server and client bundles. The
// DeployWatcher compares the client's copy with /api/version (served by
// whatever build is live) and reloads a tab that outlived a deploy — a stale
// client can't apply router.refresh() against a newer server build, so saves
// looked like they did nothing until a manual reload (Mitchell 2026-11-05).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  turbopack: {},
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
