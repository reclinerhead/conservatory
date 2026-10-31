import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Let a phone on the house Wi-Fi reach the dev server; Next blocks
  // cross-origin dev requests by default. Whole subnet, like the Aviary.
  allowedDevOrigins: ["192.168.1.*"],
};

export default nextConfig;
