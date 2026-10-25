import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image; traced from the monorepo root.
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  // *.localhost is allowed by default; lvh.me is an alternative wildcard-DNS dev domain.
  allowedDevOrigins: ["lvh.me", "*.lvh.me"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
