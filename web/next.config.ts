import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Unset on orchid and in dev; "/conservatory" on a field station, where the
  // app lives under a path beside the Aviary and the Quarry (#113). Set in
  // web/.env.local by Servers/install-station.sh. Dot access on purpose:
  // basePath is fixed at build time and lib/base-path.ts inlines the same
  // value for the browser.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // Let a phone on the house Wi-Fi reach the dev server; Next blocks
  // cross-origin dev requests by default. Whole subnet, like the Aviary.
  allowedDevOrigins: ["192.168.1.*"],
  // The repo root, not web/: globals.css imports ../../design/tokens.css,
  // and Turbopack refuses files outside its root (dev panics on every page).
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
