import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, Next may infer the workspace root from a lockfile in a
  // parent directory and nest the standalone server under that path.
  turbopack: {
    root: process.cwd(),
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Externalize packages that use Node-native deps or have dynamic worker
  // imports (pdfjs-dist via pdf-parse) so Next.js doesn't try to bundle them.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "pdfkit",
    "docx",
  ],
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-*.space-z.ai",
    "preview-chat-*.space-z.ai",
  ],
};

export default nextConfig;
