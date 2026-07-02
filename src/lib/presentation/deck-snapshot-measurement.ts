import type { Deck } from "@/lib/presentation/schema";

export type DeckSnapshotPayloadMeasurement = {
  readonly slideCount: number;
  readonly jsonBytes: number;
  readonly jsonKiB: number;
};

export function measureDeckSnapshotPayload(
  deck: Deck,
): DeckSnapshotPayloadMeasurement {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(deck)).byteLength;

  return {
    slideCount: deck.slides.length,
    jsonBytes,
    jsonKiB: Number((jsonBytes / 1024).toFixed(2)),
  };
}
