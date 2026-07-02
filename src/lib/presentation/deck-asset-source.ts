import type { Deck } from "@/lib/presentation/schema";

export function resolveDeckAssetSource(
  deck: Deck,
  assetId: string,
): string | undefined {
  const visualAssetId = deck.assets.visuals?.[assetId]?.id;
  return (
    deck.assets.images[assetId]?.src ??
    deck.assets.files?.[assetId]?.src ??
    (visualAssetId
      ? (deck.assets.images[visualAssetId]?.src ??
        deck.assets.files?.[visualAssetId]?.src)
      : undefined)
  );
}
