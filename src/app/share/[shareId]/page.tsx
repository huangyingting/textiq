import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LexicalReadOnly } from "@/components/lexical/lexical-read-only";
import { SharePasscodeGate } from "@/components/share/share-passcode-gate";

import { ShareLightbox } from "./share-lightbox";
import { MadeWithBadge } from "@/components/made-with-badge";
import { app as appEnv } from "@/lib/env";
import { buildPublicMetadata } from "@/lib/public-render/metadata";
import { resolvePublicRender } from "@/lib/public-render/resolver";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";
import { publicShareBudgetExceeded } from "@/app/public-abuse";

/** Absolute base URL for canonical/OG links. */
function siteBaseUrl(): string {
  return appEnv.url();
}

/**
 * SEO + social unfurl metadata for the share page. A shared document yields a
 * title, excerpt description, canonical URL, and Open Graph / Twitter Card tags
 * (with an auto-generated OG image, US-030). A non-shared/unknown document
 * yields safe, no-index defaults so private documents never leak.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const result = await resolvePublicRender({
    params: { shareId },
    mode: "view",
    projection: "metadata",
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
  });

  return buildPublicMetadata({
    document:
      result.ok && result.projection === "metadata" ? result.metadata : null,
    surface: "share",
    baseUrl: siteBaseUrl(),
  });
}

export default async function SharedDocumentPage({
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
    mode: "view",
    projection: "document",
    passcodeUnlocked: isPublicSharePasscodeUnlocked,
  });

  if (!result.ok || result.projection !== "document") {
    if (
      !result.decision.allow &&
      result.decision.reason === "passcode-required"
    ) {
      return (
        <SharePasscodeGate
          shareId={"shareId" in result ? result.shareId : shareId}
          mode="view"
          returnTo={`/share/${shareId}`}
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
  const { document } = result;

  return (
    <main className="min-h-screen bg-ds-surface-sunken">
      {/* Header */}
      <header className="border-b border-ds-border-subtle bg-ds-surface-base px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-ds-surface-raised px-2.5 py-0.5 text-xs font-medium text-ds-text-secondary">
              Read-only
            </span>
            <span className="text-xs text-ds-text-muted">
              Shared by {document.ownerName}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
            {document.title}
          </h1>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <ShareLightbox>
          <article className="rounded-lg border border-ds-border-subtle bg-ds-surface-base p-4 sm:p-6">
            <LexicalReadOnly state={document.contentJson} />
          </article>
        </ShareLightbox>
      </div>
      <MadeWithBadge show={document.showAttribution} />
    </main>
  );
}
