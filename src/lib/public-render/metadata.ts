import { deriveFromContentJson } from "@/lib/document-stats";
import { buildShareSegment } from "@/lib/slug";

import {
  normalizePublicMetadataMode,
  type PublicMetadataDocument,
} from "./metadata-contract";

const PUBLIC_SITE_NAME = "TextIQ";

export type PublicMetadataSurface = "share" | "present";

export interface BuildPublicMetadataInput {
  document: PublicMetadataDocument | null;
  surface: PublicMetadataSurface;
  baseUrl: string;
  siteName?: string;
}

export interface PublicPageMetadata {
  title: string;
  description?: string;
  robots?: { index: boolean; follow: boolean };
  alternates?: { canonical: string };
  openGraph?: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    type: "article";
    images: { url: string; width: number; height: number; alt: string }[];
  };
  twitter?: {
    card: "summary_large_image";
    title: string;
    description: string;
    images: string[];
  };
  other?: Record<string, string>;
}

export function buildPublicMetadata({
  document,
  surface,
  baseUrl,
  siteName = PUBLIC_SITE_NAME,
}: BuildPublicMetadataInput): PublicPageMetadata {
  if (!document?.shareId) {
    return {
      title:
        surface === "share"
          ? `Shared Document — ${siteName}`
          : `Presentation — ${siteName}`,
      robots: { index: false, follow: false },
    };
  }

  const segment = buildShareSegment(document.slug, document.shareId);
  const canonical =
    surface === "share"
      ? `${baseUrl}/share/${segment}`
      : `${baseUrl}/present/${segment}`;
  const shareCanonical = `${baseUrl}/share/${segment}`;
  const metadataMode = normalizePublicMetadataMode(document.metadataMode);
  const canShowTitle =
    metadataMode === "title" || metadataMode === "title-excerpt";
  const canShowExcerpt = metadataMode === "title-excerpt";
  const safeTitle = canShowTitle ? document.title : "Shared Document";
  const description = canShowExcerpt
    ? deriveFromContentJson(document.contentJson).excerpt
    : "A read-only document shared with TextIQ.";
  const ogImage = `${baseUrl}/share/${segment}/opengraph-image`;
  const pageTitle =
    surface === "share"
      ? `${safeTitle} — ${siteName}`
      : `${safeTitle} — Presentation — ${siteName}`;

  return {
    title: pageTitle,
    description,
    robots: {
      index: document.discoverable ?? false,
      follow: document.discoverable ?? false,
    },
    alternates: { canonical },
    openGraph: {
      title: pageTitle,
      description,
      url: canonical,
      siteName,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630, alt: safeTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [ogImage],
    },
    ...(surface === "present"
      ? { other: { "og:see_also": shareCanonical } }
      : {}),
  };
}
