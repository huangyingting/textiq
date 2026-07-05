import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicPresentViewer } from "@/components/presentation/public-present-viewer";
import { publicShareBudgetExceeded } from "@/app/public-abuse";
import { buildPresentEmbedRenderInput } from "@/lib/public-render/present-embed-route";
import { publicPresentationRecoveryForViewer } from "@/lib/public-render/presentation";
import { resolvePublicRender } from "@/lib/public-render/resolver";

export const metadata: Metadata = {
  title: "Presentation — TextIQ",
};

/**
 * Chrome-free embeddable presentation viewer.
 *
 * Mirrors the `/embed/[shareId]` pattern for documents — shares the same
 * access gating (isShared + non-deleted) but renders the deck one slide at a
 * time in a frameless, HUD-minimal layout suitable for `<iframe>` embedding.
 *
 * The global site header is suppressed for all `/present/*` paths by
 * {@link HeaderGate}.
 */
export default async function PresentEmbedPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  if (await publicShareBudgetExceeded()) {
    notFound();
  }

  const result = await resolvePublicRender(
    buildPresentEmbedRenderInput(shareId),
  );

  if (!result.ok || result.projection !== "presentation") {
    notFound();
  }
  const { presentation } = result;
  const recovery = publicPresentationRecoveryForViewer(presentation.recovery);

  return (
    <PublicPresentViewer
      deck={presentation.deck}
      themePackage={presentation.themePackage}
      visuals={presentation.visuals}
      title={presentation.title}
      embed
      recovery={recovery}
      showAttribution={presentation.attribution.showAttribution}
    />
  );
}
