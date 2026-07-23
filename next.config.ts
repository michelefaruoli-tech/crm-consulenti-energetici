import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Allegati CI/bolletta in base64 superano facilmente il default 1MB
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
