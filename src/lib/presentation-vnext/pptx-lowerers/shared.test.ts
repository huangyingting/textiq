import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DiagnosticCollector } from "../diagnostics";
import type { FillStyle, StyleObject } from "../style-schema";
import {
  canvasToPptxDimensions,
  checkEffect,
  effectToImageRetryFill,
  effectToNativeGlow,
  fillToHex,
  fillToPptxFill,
  frameToInches,
  pxToIn,
  resolveColor,
  styleToTextOptions,
  toHex,
} from "./shared";

function dc() {
  return new DiagnosticCollector();
}

function decodeSvg(dataUri: string): string {
  const encoded = dataUri.replace("data:image/svg+xml;base64,", "");
  return Buffer.from(encoded, "base64").toString("utf8");
}

describe("pptx lowerer shared helpers", () => {
  test("converts canvas and frames into PPTX dimensions", () => {
    assert.deepEqual(
      canvasToPptxDimensions({
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
      }),
      { layout: "LAYOUT_WIDE", slideW: 13.333, slideH: 7.5 },
    );
    assert.deepEqual(
      canvasToPptxDimensions({
        format: "4:3",
        width: 100,
        height: 75,
        unit: "percent",
      }),
      { layout: "LAYOUT_4X3", slideW: 10, slideH: 7.5 },
    );
    assert.deepEqual(
      canvasToPptxDimensions({
        format: "square",
        width: 100,
        height: 100,
        unit: "percent",
      }),
      { layout: "LAYOUT_CUSTOM", slideW: 7.5, slideH: 7.5 },
    );
    assert.equal(
      canvasToPptxDimensions({
        format: "custom",
        width: 200,
        height: 100,
        unit: "percent",
      }).slideH,
      6.6665,
    );
    assert.deepEqual(pxToIn({ x: 50, y: 25, w: 25, h: 50 }, 100, 100, 10, 8), {
      x: 5,
      y: 2,
      w: 2.5,
      h: 4,
    });
    assert.deepEqual(
      frameToInches(
        { x: 10, y: 20, w: 30, h: 40 },
        {
          basis: { w: 100, h: 100 },
          dims: { layout: "LAYOUT_CUSTOM", slideW: 10, slideH: 5 },
          dc: dc(),
        },
      ),
      { x: 1, y: 1, w: 3, h: 2 },
    );
  });

  test("normalizes and resolves colors with diagnostics for unresolved tokens", () => {
    const collector = dc();
    assert.equal(toHex(" #abc123 "), "ABC123");
    assert.equal(toHex("abc123"), "ABC123");
    assert.equal(
      resolveColor(
        { token: "colors.accent" },
        "#ffffff",
        collector,
        "node.fill",
      ),
      "FFFFFF",
    );
    assert.equal(collector.diagnostics[0]?.code, "missing-token");
  });

  test("maps native and fallback effects", () => {
    const invalid = dc();
    assert.equal(
      effectToNativeGlow(
        { kind: "glow", color: "#00ff00", blurPt: 0 },
        invalid,
        "shape",
      ),
      undefined,
    );
    assert.equal(invalid.diagnostics[0]?.code, "unsupported-export-feature");

    const glow = effectToNativeGlow(
      { kind: "glow", color: { token: "x" }, blurPt: 99, opacity: 2 },
      dc(),
      "shape",
    );
    assert.deepEqual(glow, {
      kind: "glow",
      color: "FFFFFF",
      blurPt: 30,
      opacity: 1,
    });
    assert.equal(
      effectToNativeGlow({ kind: "none" }, dc(), "shape"),
      undefined,
    );
    assert.equal(
      effectToNativeGlow({ kind: "blur", radiusPt: 2 }, dc(), "shape"),
      undefined,
    );

    const unsupportedFill = dc();
    assert.equal(
      effectToImageRetryFill(
        {
          effect: { kind: "blur", radiusPt: 2 },
          fill: { type: "linearGradient", from: "#000000", to: "#ffffff" },
        },
        "rect",
        unsupportedFill,
        "shape",
      ),
      undefined,
    );
    assert.equal(
      unsupportedFill.diagnostics[0]?.action?.type,
      "replace-style-ref",
    );

    for (const shape of [
      "circle",
      "diamond",
      "triangle",
      "roundRect",
      "rect",
    ]) {
      const result = effectToImageRetryFill(
        {
          effect: { kind: "glass", intensity: "medium" },
          fill: { type: "solid", color: "#336699" },
        },
        shape,
        dc(),
        "shape",
      );
      assert.equal(result?.kind, "image");
      assert.match(decodeSvg(result!.assetId), /filter|fill="#336699"/);
    }
  });

  test("converts fills to PPTX fill fallbacks and hex fallbacks", () => {
    const collector = dc();
    assert.equal(fillToPptxFill(undefined, collector, "fill"), undefined);
    assert.equal(
      fillToPptxFill({ type: "solid", color: "#112233" }, collector, "fill"),
      "112233",
    );
    assert.deepEqual(
      fillToPptxFill({ type: "image", assetId: "img-1" }, collector, "fill"),
      { kind: "image", assetId: "img-1", fit: "cover" },
    );
    assert.equal(
      fillToPptxFill({ type: "image" } as never, collector, "fill"),
      undefined,
    );

    const fills: FillStyle[] = [
      { type: "linearGradient", from: "#000000", to: "#ffffff" },
      { type: "radialGradient", inner: "#111111", outer: "#eeeeee" },
      {
        type: "pattern",
        kind: "dots",
        color: "#111111",
        background: "#ffffff",
        spacingPct: 2,
        strokeWidthPct: 0,
      },
      {
        type: "pattern",
        kind: "grid",
        color: "#111111",
        background: "#ffffff",
      },
      {
        type: "pattern",
        kind: "scanlines",
        color: "#111111",
        background: "#ffffff",
      },
      {
        type: "pattern",
        kind: "stripes",
        color: "#111111",
        background: "#ffffff",
      },
      { type: "conicGradient", stops: [{ color: "#123456", offsetPct: 150 }] },
      { type: "repeatingLinearGradient", stops: [] },
    ];
    for (const fill of fills) {
      const pptx = fillToPptxFill(fill, collector, `fill.${fill.type}`);
      assert.equal(typeof (pptx as { assetId?: string })?.assetId, "string");
      fillToHex(fill, collector, `hex.${fill.type}`);
    }
    assert.equal(
      fillToHex({ type: "image", assetId: "img" }, collector, "hex.image"),
      undefined,
    );
    assert.equal(fillToHex(undefined, collector, "hex.none"), undefined);
    assert.ok(collector.diagnostics.length >= 10);
  });

  test("extracts text options and warns for unsupported editable effects", () => {
    const style: StyleObject = {
      text: {
        color: "#abcdef",
        fontSizePt: 14,
        fontFamily: "Inter, system-ui",
        weight: 700,
        italic: true,
        underline: true,
        strikethrough: true,
        align: "center",
        verticalAlign: "middle",
        lineHeight: 1.2,
        paragraphSpacingPt: 8,
      },
    };
    assert.deepEqual(styleToTextOptions({}), {});
    assert.deepEqual(styleToTextOptions(style), {
      color: "ABCDEF",
      fontSize: 14,
      fontFace: "Aptos",
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      align: "center",
      valign: "middle",
      lineHeightMultiple: 1.2,
      paragraphSpacePt: 8,
    });

    const collector = dc();
    checkEffect({}, collector, "shape");
    checkEffect(
      { effect: { kind: "glow", color: "#fff", blurPt: 4 } },
      collector,
      "shape",
    );
    checkEffect({ effect: { kind: "blur", radiusPt: 4 } }, collector, "shape");
    checkEffect(
      { effect: { kind: "glass", intensity: "strong" } },
      collector,
      "shape",
    );
    assert.equal(collector.diagnostics.length, 2);
  });
});
