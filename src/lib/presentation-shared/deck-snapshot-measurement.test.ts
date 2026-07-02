import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { measureDeckSnapshotPayload } from "@/lib/presentation-shared/deck-snapshot-measurement";
import {
  buildComparisonSlide,
  buildContentSlide,
  buildCoverSlide,
  buildDeckV7,
  buildTableSlide,
  buildVisualSlide,
  resetBuilderCounter,
} from "@/test/builders/deck-v7";

const MEASURED_SLIDE_COUNTS = [1, 5, 10, 25, 50, 75, 150, 300] as const;
const EXPECTED_JSON_BYTES_BY_SLIDE_COUNT = new Map<number, number>([
  [1, 868],
  [5, 3328],
  [10, 6321],
  [25, 15300],
  [50, 30265],
  [75, 45230],
  [150, 90125],
  [300, 179915],
]);

function buildRepresentativeDeck(slideCount: number) {
  resetBuilderCounter();
  const slideBuilders = [
    buildCoverSlide,
    () => buildContentSlide("Measured Content"),
    buildTableSlide,
    buildComparisonSlide,
    buildVisualSlide,
  ] as const;

  return buildDeckV7(
    Array.from({ length: slideCount }, (_, index) =>
      slideBuilders[index % slideBuilders.length](),
    ),
  );
}

describe("measureDeckSnapshotPayload", () => {
  test("computes deterministic serialized DeckV7 snapshot byte sizes", () => {
    const measurements = MEASURED_SLIDE_COUNTS.map((slideCount) => {
      const measurement = measureDeckSnapshotPayload(
        buildRepresentativeDeck(slideCount),
      );

      return [measurement.slideCount, measurement.jsonBytes] as const;
    });

    assert.deepEqual(
      measurements,
      Array.from(EXPECTED_JSON_BYTES_BY_SLIDE_COUNT.entries()),
    );
  });

  test("reports rounded KiB for documentation tables", () => {
    assert.deepEqual(measureDeckSnapshotPayload(buildRepresentativeDeck(25)), {
      slideCount: 25,
      jsonBytes: 15300,
      jsonKiB: 14.94,
    });
  });
});
