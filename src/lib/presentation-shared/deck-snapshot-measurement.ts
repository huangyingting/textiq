import type { DeckV7 } from "@/lib/presentation-vnext/schema";

export type DeckSnapshotPayloadMeasurement = {
  readonly slideCount: number;
  readonly jsonBytes: number;
  readonly jsonKiB: number;
};

export function measureDeckSnapshotPayload(
  deck: DeckV7,
): DeckSnapshotPayloadMeasurement {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(deck)).byteLength;

  return {
    slideCount: deck.slides.length,
    jsonBytes,
    jsonKiB: Number((jsonBytes / 1024).toFixed(2)),
  };
}
