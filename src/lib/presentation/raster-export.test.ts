import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  exportDeckRaster,
  type RasterSlideDimensions,
} from "@/lib/presentation/raster-export";
import {
  buildDeck,
  buildImageNode,
  buildMinimalThemePackage,
  buildSlide,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=";

describe("exportDeckRaster", () => {
  test("renders one PNG per slide and assembles an N-page PDF", async () => {
    resetBuilderCounter();
    const deck = buildDeck([
      buildSlide("content", [buildTextNode()]),
      buildSlide("content", [buildImageNode("missing-image")]),
    ]);
    const renderedSlides: Array<{
      slideId: string;
      dimensions: RasterSlideDimensions;
    }> = [];

    const result = await exportDeckRaster(
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
