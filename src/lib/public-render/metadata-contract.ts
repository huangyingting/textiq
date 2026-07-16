export type PublicMetadataMode = "generic" | "title" | "title-excerpt";

export interface PublicMetadataSource {
  title: string;
  contentJson: unknown;
  metadataMode: string | null;
}

export interface PublicMetadataDocument extends PublicMetadataSource {
  slug: string | null;
  shareId: string | null;
  discoverable: boolean | null;
}

export function normalizePublicMetadataMode(
  metadataMode: string | null | undefined,
): PublicMetadataMode {
  return metadataMode === "title" || metadataMode === "title-excerpt"
    ? metadataMode
    : "generic";
}
