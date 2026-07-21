import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  exportDeckRaster,
  resolveRasterSlideDimensions,
  type RasterSlideDimensions,
} from "@/lib/presentation/raster-export";
import {
  CUSTOM_EXPORT_MAX_AXIS_IN,
  resolveCanvasAspectRatio,
  resolveCappedCanvasInches,
} from "@/lib/presentation/export-geometry";
import {
  buildCanvasSpec,
  buildDeck,
  buildImageNode,
  buildMinimalThemePackage,
  buildSlide,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=";

function assertApproxEqual(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.000001);
}

describe("exportDeckRaster", () => {
  test("resolves capped custom export inches across boundary and extreme ratios", () => {
    assert.equal(resolveCanvasAspectRatio(0, 100, 4 / 3), 4 / 3);
    assert.equal(resolveCanvasAspectRatio(100, 0, 1), 1);
    assert.equal(resolveCanvasAspectRatio(100, 100), 1);

    assert.deepEqual(resolveCappedCanvasInches(100, 100), {
      widthIn: CUSTOM_EXPORT_MAX_AXIS_IN,
      heightIn: CUSTOM_EXPORT_MAX_AXIS_IN,
    });
    const wide = resolveCappedCanvasInches(1920, 1080);
    assert.equal(wide.widthIn, CUSTOM_EXPORT_MAX_AXIS_IN);
    assertApproxEqual(wide.heightIn, 7.4998125);

    const portrait = resolveCappedCanvasInches(1080, 1920);
    assertApproxEqual(portrait.widthIn, 7.4998125);
    assert.equal(portrait.heightIn, CUSTOM_EXPORT_MAX_AXIS_IN);

    const ultrawide = resolveCappedCanvasInches(3200, 900);
    assert.equal(ultrawide.widthIn, CUSTOM_EXPORT_MAX_AXIS_IN);
    assert.ok(ultrawide.heightIn < 4);

    const ultraPortrait = resolveCappedCanvasInches(900, 3200);
    assert.equal(ultraPortrait.heightIn, CUSTOM_EXPORT_MAX_AXIS_IN);
    assert.ok(ultraPortrait.widthIn < 4);
  });

  test("resolves native raster physical dimensions without changing standard formats", () => {
    const wideDeck = buildDeck([], {
      canvas: buildCanvasSpec({
        format: "16:9",
        width: 100,
        height: 56.25,
      }),
    });
    assert.deepEqual(resolveRasterSlideDimensions(wideDeck, 960), {
      widthPx: 960,
      heightPx: 540,
      widthIn: 13.333,
      heightIn: 7.5,
    });

    const standardDeck = buildDeck([], {
      canvas: buildCanvasSpec({
        format: "4:3",
        width: 100,
        height: 75,
      }),
    });
    assert.deepEqual(resolveRasterSlideDimensions(standardDeck, 960), {
      widthPx: 960,
      heightPx: 720,
      widthIn: 10,
      heightIn: 7.5,
    });
  });

  test("resolves custom raster physical dimensions from the canvas aspect ratio", () => {
    const squareDeck = buildDeck([], {
      canvas: buildCanvasSpec({
        format: "square",
        width: 100,
        height: 100,
      }),
    });
    assert.deepEqual(resolveRasterSlideDimensions(squareDeck, 960), {
      widthPx: 960,
      heightPx: 960,
      widthIn: 13.333,
      heightIn: 13.333,
    });

    const portraitDeck = buildDeck([], {
      canvas: buildCanvasSpec({
        format: "custom",
        width: 9,
        height: 16,
      }),
    });
    const portraitDims = resolveRasterSlideDimensions(portraitDeck, 900);
    assert.equal(portraitDims.widthPx, 900);
    assert.equal(portraitDims.heightPx, 1600);
    assert.equal(portraitDims.heightIn, 13.333);
    assert.ok(Math.abs(portraitDims.widthIn - 7.4998125) < 0.000001);
  });

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
