import type { NextConfig } from "next";

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").origin;
const httpsSite = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
const isDev = process.env.NODE_ENV === "development";

// Pages are statically generated, so scripts can't carry per-request nonces and inline
// scripts stay allowed (theme/locale init, the RSC payload). What the policy does stop:
// loading scripts from other origins, and sending anything (e.g. a stolen session token)
// anywhere except this site and the API. Sessions live in localStorage, so the
// connect/img/media limits are the part that matters.
const csp = [
  "default-src 'self'",
  // blob: is the live-dictation audio worklet (LiveDictation.tsx), which worklets load under script-src.
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `media-src 'self' blob: ${apiOrigin}`,
  `connect-src 'self' ${apiOrigin} ${apiOrigin.replace(/^http/, "ws")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(httpsSite ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The recorder and live dictation need the microphone; nothing needs the rest.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(httpsSite ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
