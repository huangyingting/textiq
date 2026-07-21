import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

export function resolveDeckAssetSource(
  deck: Deck,
  assetId: string,
  pkg?: ThemePackageV1 | null,
): string | undefined {
  const visualAssetId = deck.assets.visuals?.[assetId]?.id;
  return (
    deck.assets.images[assetId]?.src ??
    pkg?.assets?.images?.[assetId]?.src ??
    deck.assets.files?.[assetId]?.src ??
    (visualAssetId
      ? (deck.assets.images[visualAssetId]?.src ??
        pkg?.assets?.images?.[visualAssetId]?.src ??
        deck.assets.files?.[visualAssetId]?.src)
      : undefined)
  );
}
