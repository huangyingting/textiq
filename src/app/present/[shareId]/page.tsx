import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicPresentViewerVNext } from "@/components/presentation-vnext/public-present-viewer-vnext";
import { publicShareBudgetExceeded } from "@/app/public-abuse";
import { app as appEnv } from "@/lib/env";
import { buildPublicMetadata } from "@/lib/public-render/metadata";
import { resolvePublicRender } from "@/lib/public-render/resolver";

function siteBaseUrl(): string {
  return appEnv.url();
}

/**
 * SEO + social unfurl metadata for the public presentation page.
 * Mirrors the `/share/[shareId]` `generateMetadata` pattern.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const result = await resolvePublicRender({
    params: { shareId },
    mode: "present",
    projection: "metadata",
  });

  return buildPublicMetadata({
    document:
      result.ok && result.projection === "metadata" ? result.metadata : null,
    surface: "present",
    baseUrl: siteBaseUrl(),
  });
}

export default async function PresentPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  if (await publicShareBudgetExceeded()) {
    notFound();
  }

  const result = await resolvePublicRender({
    params: { shareId },
    mode: "present",
    projection: "presentation",
  });

  if (!result.ok || result.projection !== "presentation") {
    notFound();
  }
  const { presentation } = result;

  return (
    <PublicPresentViewerVNext
      deck={presentation.deckV7}
      themePackage={presentation.themePackage}
      visuals={presentation.visuals}
      title={presentation.title}
      recovery={presentation.recovery}
      showAttribution={presentation.attribution.showAttribution}
    />
  );
}
