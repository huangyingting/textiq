import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  exportDeckV7Raster,
  type RasterSlideDimensions,
} from "@/lib/presentation-vnext/raster-export";
import {
  buildDeckV7,
  buildImageNode,
  buildMinimalThemePackage,
  buildSlideV7,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/deck-v7";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=";

describe("exportDeckV7Raster", () => {
  test("renders one PNG per slide and assembles an N-page PDF", async () => {
    resetBuilderCounter();
    const deck = buildDeckV7([
      buildSlideV7("content", [buildTextNode()]),
      buildSlideV7("content", [buildImageNode("missing-image")]),
    ]);
    const renderedSlides: Array<{
      slideId: string;
      dimensions: RasterSlideDimensions;
    }> = [];

    const result = await exportDeckV7Raster(
      deck,
      async (slide, dimensions) => {
        renderedSlides.push({ slideId: slide.id, dimensions });
        return ONE_PIXEL_PNG;
      },
      { themePackage: buildMinimalThemePackage(), widthPx: 960 },
    );

    assert.equal(result.pngs.length, 2);
    assert.deepEqual(
      result.pngs.map((png) => png.slideId),
      renderedSlides.map((slide) => slide.slideId),
    );
    assert.ok(
      renderedSlides.every((slide) => slide.dimensions.widthPx === 960),
    );
    assert.equal(result.pdfPageCount, 2);
    assert.ok(result.pdfBytes.byteLength > 0);
    assert.equal(result.pdfBlob.type, "application/pdf");
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "missing-asset",
      ),
      "expected preflight diagnostics to be surfaced",
    );
  });
});
