import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.GITHUB_PAGES === 'true' ? {
    output: 'export',
    trailingSlash: false,
    images: { unoptimized: true },
  } : {}),
};

export default nextConfig;
