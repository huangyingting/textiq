import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicPresentViewer } from "@/components/presentation/public-present-viewer";
import { SharePasscodeGate } from "@/components/share/share-passcode-gate";
import { publicShareBudgetExceeded } from "@/app/public-abuse";
import { app as appEnv } from "@/lib/env";
import { buildPublicMetadata } from "@/lib/public-render/metadata";
import { publicPresentationRecoveryForViewer } from "@/lib/public-render/presentation";
import { adaptPublicRouteOutcome } from "@/lib/public-render/route-outcome";
import { resolvePublicRender } from "@/lib/public-render/resolver";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";

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
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
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
    params: { shareId },
    mode: "present",
    projection: "presentation",
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
  });

  const outcome = adaptPublicRouteOutcome(
    result,
    "presentation",
    shareId,
    passcodeStatus,
  );
  if (outcome.kind === "passcode-required") {
    return (
      <SharePasscodeGate
        shareId={outcome.gate.shareId}
        mode="present"
        returnTo={`/present/${shareId}`}
        error={outcome.gate.error}
      />
    );
  }
  if (outcome.kind === "not-found") {
    notFound();
  }
  const { presentation } = outcome.result;
  const recovery = publicPresentationRecoveryForViewer(presentation.recovery);

  return (
    <PublicPresentViewer
      deck={presentation.deck}
      themePackage={presentation.themePackage}
      visuals={presentation.visuals}
      title={presentation.title}
      recovery={recovery}
      showAttribution={presentation.attribution.showAttribution}
    />
  );
}
