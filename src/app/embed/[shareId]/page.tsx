import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LexicalReadOnly } from "@/components/lexical/lexical-read-only";
import { MadeWithBadge } from "@/components/made-with-badge";
import { SharePasscodeGate } from "@/components/share/share-passcode-gate";
import { publicShareBudgetExceeded } from "@/app/public-abuse";
import { adaptPublicRouteOutcome } from "@/lib/public-render/route-outcome";
import { resolvePublicRender } from "@/lib/public-render/resolver";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";

export const metadata: Metadata = {
  title: "Embedded Document — TextIQ",
};

/**
 * Minimal, chrome-free page for embedding a shared document in an iframe on
 * another site. It mirrors `/share/[shareId]` scoping — it only resolves when
 * the document `isShared` — but renders no header/nav and no auth/session
 * widgets (the global header is suppressed for `/embed/*` by `HeaderGate`). It
 * sets no framing-blocking headers, so it is safe to embed.
 *
 * Documents render read-only from `contentJson` (blocks + inline visuals).
 */
export default async function EmbedPage({
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
    mode: "embed",
    projection: "document",
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
  });

  const outcome = adaptPublicRouteOutcome(
    result,
    "document",
    shareId,
    passcodeStatus,
  );
  if (outcome.kind === "passcode-required") {
    return (
      <SharePasscodeGate
        shareId={outcome.gate.shareId}
        mode="embed"
        returnTo={`/embed/${shareId}`}
        error={outcome.gate.error}
      />
    );
  }
  if (outcome.kind === "not-found") {
    notFound();
  }
  const { document } = outcome.result;

  return (
    <main className="min-h-screen w-full bg-ds-surface-base p-4">
      <div className="mx-auto w-full max-w-3xl">
        <LexicalReadOnly state={document.contentJson} />
      </div>
      <MadeWithBadge show={document.showAttribution} />
    </main>
  );
}
