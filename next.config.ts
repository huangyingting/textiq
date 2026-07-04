import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright probes use 127.0.0.1; allow dev client resources so public
  // presentation hydration and App Router not-found boundaries are visible.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep the PDF parser and its pdfjs-dist dependency out of the bundle so
  // pdfjs can resolve its worker (`pdf.worker.mjs`) from node_modules at
  // runtime instead of a rewritten bundle path that does not exist.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
