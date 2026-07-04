import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicPresentViewer } from "@/components/presentation/public-present-viewer";
import { SharePasscodeGate } from "@/components/share/share-passcode-gate";
import { publicShareBudgetExceeded } from "@/app/public-abuse";
import { buildPresentEmbedRenderInput } from "@/lib/public-render/present-embed-route";
import { resolvePublicRender } from "@/lib/public-render/resolver";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";

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
  searchParams,
}: {
  params: Promise<{ shareId: string }>;
  searchParams?: Promise<{ passcode?: string }>;
}) {
  const { shareId } = await params;
  const passcodeStatus = (await searchParams)?.passcode;
  if (await publicShareBudgetExceeded()) {
    notFound();
  }

  const result = await resolvePublicRender({
    ...buildPresentEmbedRenderInput(shareId),
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
  });

  if (!result.ok || result.projection !== "presentation") {
    if (
      !result.decision.allow &&
      result.decision.reason === "passcode-required"
    ) {
      return (
        <SharePasscodeGate
          shareId={"shareId" in result ? result.shareId : shareId}
          mode="embed"
          returnTo={`/present/${shareId}/embed`}
          error={
            passcodeStatus === "invalid" || passcodeStatus === "limited"
              ? passcodeStatus
              : undefined
          }
        />
      );
    }
    notFound();
  }
  const { presentation } = result;

  return (
    <PublicPresentViewer
      deck={presentation.deck}
      themePackage={presentation.themePackage}
      visuals={presentation.visuals}
      title={presentation.title}
      embed
      recovery={presentation.recovery}
      showAttribution={presentation.attribution.showAttribution}
    />
  );
}
