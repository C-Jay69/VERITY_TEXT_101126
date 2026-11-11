import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
