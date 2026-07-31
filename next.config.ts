import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.E2E_PROFILE_DIST_DIR || ".next",
  // Playwright probes use 127.0.0.1; allow dev client resources so public
  // presentation hydration and App Router not-found boundaries are visible.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep the PDF parser and its pdfjs-dist dependency out of the bundle so
  // pdfjs can resolve its worker (`pdf.worker.mjs`) from node_modules at
  // runtime instead of a rewritten bundle path that does not exist.
  // The custom server imports Yjs for the inline collaboration socket before
  // Next renders the editor. Keep the server-side editor import external so
  // both paths share one Yjs module instance instead of loading a bundled copy.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "yjs"],
};

export default nextConfig;
