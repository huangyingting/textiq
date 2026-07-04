import type { Metadata } from "next";

import { NotFoundFallback } from "@/components/not-found-fallback";

export const metadata: Metadata = {
  title: "Page not found — TextIQ",
};

/**
 * App Router not-found UI. Rendered for unmatched routes and whenever a route
 * segment calls `notFound()`. It's a Server Component (no interactivity needed)
 * styled to match the app's design-system chrome. The root {@link SiteHeader}
 * from the layout stays visible above it.
 */
export default function NotFound() {
  return <NotFoundFallback />;
}
