import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

// Enable getCloudflareContext() during `next dev` only. It must NOT run during
// the production build: it spins up a miniflare platform proxy that asserts a
// built container image id whenever a `containers` binding is defined (the live
// image is built/pushed only at deploy — Plan 5 / gate G2). The dev server runs
// in the "phase-development-server" phase; the build runs in another phase.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NEXT_PHASE === "phase-development-server") {
  void initOpenNextCloudflareForDev();
}
