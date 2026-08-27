import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Allegati CI/bolletta in base64 superano facilmente il default 1MB
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    const headers =
      process.env.NODE_ENV === "development"
        ? securityHeaders.filter((h) => h.key !== "X-Frame-Options")
        : securityHeaders;
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
