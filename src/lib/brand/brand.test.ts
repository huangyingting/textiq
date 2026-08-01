/**
 * Unit tests for brand logic (US-007 — Brand Studio).
 *
 * Tests: brand→theme mapping, applyBrand preserves content, applyBrand to all
 * visuals, upload validation, validateBrandInput.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseBrandListResponse,
  parsePalette,
  validateBrandInput,
} from "@/lib/brand/schema";
import {
  applyBrand,
  brandToStylePatch,
  isBrandActive,
  brandPreviewStyle,
} from "@/lib/brand/transforms";
import { validateFontUpload, validateLogoUpload } from "@/lib/brand/upload";
import { BRAND_FONT_MAX_BYTES, BRAND_LOGO_MAX_BYTES } from "@/lib/limits";
import { DEFAULT_STYLE, type Visual } from "@/lib/visual/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVisual(): Visual {
  return {
    version: 1,
    type: "flowchart",
    width: 760,
    height: 480,
    nodes: [
      { id: "n1", label: "Start", x: 100, y: 100 },
      { id: "n2", label: "End", x: 300, y: 100 },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2" }],
    style: { ...DEFAULT_STYLE, palette: [...DEFAULT_STYLE.palette] },
  };
}

const FULL_BRAND = {
  id: "b1",
  name: "Acme",
  ownerId: "u1",
  palette: ["#ff0000", "#00ff00", "#0000ff"],
  background: "#fafafa",
  nodeFill: "#ffe4e6",
  nodeStroke: "#be123c",
  nodeText: "#881337",
  edgeColor: "#fda4af",
  fontFamily: "'Inter', sans-serif",
  fontAssetUrl: null,
  logoAssetUrl: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const PARTIAL_BRAND = {
  ...FULL_BRAND,
  nodeFill: null,
  fontFamily: null,
};

// ---------------------------------------------------------------------------
// Brand list response parsing
// ---------------------------------------------------------------------------

describe("parseBrandListResponse", () => {
  it("accepts the complete serialized API contract", () => {
    const result = parseBrandListResponse({ brands: [FULL_BRAND] });

    assert.ok(result);
    assert.equal(result[0]?.id, "b1");
    assert.equal(result[0]?.fontAssetUrl, null);
    assert.deepEqual(result[0]?.palette, FULL_BRAND.palette);
  });

  it("accepts optional asset ids when they are null or strings", () => {
    const result = parseBrandListResponse({
      brands: [
        {
          ...FULL_BRAND,
          logoAssetId: "logo-1",
          fontAssetId: null,
        },
      ],
    });

    assert.equal(result?.[0]?.logoAssetId, "logo-1");
    assert.equal(result?.[0]?.fontAssetId, null);
  });

  it("rejects missing lists, malformed rows, and invalid persisted colors", () => {
    assert.equal(parseBrandListResponse({}), null);
    assert.equal(parseBrandListResponse({ brands: "bad" }), null);
    assert.equal(parseBrandListResponse({ brands: [null] }), null);
    assert.equal(
      parseBrandListResponse({
        brands: [{ ...FULL_BRAND, nodeFill: "url(javascript:bad)" }],
      }),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// brandToStylePatch
// ---------------------------------------------------------------------------

describe("brandToStylePatch", () => {
  it("maps all set fields", () => {
    const patch = brandToStylePatch(FULL_BRAND);
    assert.deepEqual(patch.palette, FULL_BRAND.palette);
    assert.equal(patch.background, FULL_BRAND.background);
    assert.equal(patch.nodeFill, FULL_BRAND.nodeFill);
    assert.equal(patch.nodeStroke, FULL_BRAND.nodeStroke);
    assert.equal(patch.nodeText, FULL_BRAND.nodeText);
    assert.equal(patch.edgeColor, FULL_BRAND.edgeColor);
    assert.equal(patch.fontFamily, FULL_BRAND.fontFamily);
  });

  it("omits null fields from patch", () => {
    const patch = brandToStylePatch(PARTIAL_BRAND);
    assert.equal("nodeFill" in patch, false);
    assert.equal("fontFamily" in patch, false);
  });
});

// ---------------------------------------------------------------------------
// applyBrand — preserves content, schema-valid result
// ---------------------------------------------------------------------------

describe("applyBrand", () => {
  it("preserves node and edge content", () => {
    const visual = makeVisual();
    const result = applyBrand(visual, FULL_BRAND);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes[0].label, "Start");
    assert.equal(result.edges[0].id, "e1");
  });

  it("applies brand colors to style", () => {
    const result = applyBrand(makeVisual(), FULL_BRAND);
    assert.equal(result.style.background, FULL_BRAND.background);
    assert.equal(result.style.nodeFill, FULL_BRAND.nodeFill);
    assert.deepEqual(result.style.palette, FULL_BRAND.palette);
  });

  it("does not mutate the input visual", () => {
    const visual = makeVisual();
    const origBg = visual.style.background;
    applyBrand(visual, FULL_BRAND);
    assert.equal(visual.style.background, origBg);
  });

  it("preserves fontSize and fontWeight (typography)", () => {
    const visual = makeVisual();
    const result = applyBrand(visual, FULL_BRAND);
    assert.equal(result.style.fontSize, DEFAULT_STYLE.fontSize);
    assert.equal(result.style.fontWeight, DEFAULT_STYLE.fontWeight);
  });

  it("skips null brand fields (partial brand)", () => {
    const visual = makeVisual();
    const result = applyBrand(visual, PARTIAL_BRAND);
    // nodeFill is null in PARTIAL_BRAND → should keep visual default
    assert.equal(result.style.nodeFill, DEFAULT_STYLE.nodeFill);
    // fontFamily is null → kept
    assert.equal(result.style.fontFamily, DEFAULT_STYLE.fontFamily);
    // but the set fields should be applied
    assert.equal(result.style.background, PARTIAL_BRAND.background);
  });

  it("returns a new object reference", () => {
    const visual = makeVisual();
    const result = applyBrand(visual, FULL_BRAND);
    assert.notEqual(result, visual);
    assert.notEqual(result.style, visual.style);
    assert.notEqual(result.nodes, visual.nodes);
  });
});

// ---------------------------------------------------------------------------
// isBrandActive
// ---------------------------------------------------------------------------

describe("isBrandActive", () => {
  it("true after applying the brand", () => {
    const visual = makeVisual();
    const applied = applyBrand(visual, FULL_BRAND);
    assert.equal(isBrandActive(applied, FULL_BRAND), true);
  });

  it("false before applying the brand", () => {
    const visual = makeVisual();
    assert.equal(isBrandActive(visual, FULL_BRAND), false);
  });
});

// ---------------------------------------------------------------------------
// brandPreviewStyle
// ---------------------------------------------------------------------------

describe("brandPreviewStyle", () => {
  it("produces a complete VisualStyle with brand overrides", () => {
    const preview = brandPreviewStyle(FULL_BRAND);
    assert.equal(preview.background, FULL_BRAND.background);
    assert.deepEqual(preview.palette, FULL_BRAND.palette);
    assert.equal(preview.fontSize, DEFAULT_STYLE.fontSize);
  });

  it("falls back to DEFAULT_STYLE for null fields", () => {
    const preview = brandPreviewStyle(PARTIAL_BRAND);
    assert.equal(preview.nodeFill, DEFAULT_STYLE.nodeFill);
    assert.equal(preview.fontFamily, DEFAULT_STYLE.fontFamily);
  });
});

// ---------------------------------------------------------------------------
// validateBrandInput
// ---------------------------------------------------------------------------

describe("validateBrandInput", () => {
  it("accepts a valid full input", () => {
    const result = validateBrandInput({
      name: "My Brand",
      palette: ["#ff0000", "#00ff00"],
      background: "#ffffff",
      nodeFill: "#eeeeee",
      nodeStroke: "#333333",
      nodeText: "#000000",
      edgeColor: "#999999",
      fontFamily: "'Inter', sans-serif",
      logoAssetId: "logo-asset",
      fontAssetId: "font-asset",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.name, "My Brand");
      assert.equal(result.data.logoAssetId, "logo-asset");
      assert.equal(result.data.fontAssetId, "font-asset");
    }
  });

  it("rejects empty name", () => {
    const result = validateBrandInput({ name: "   " });
    assert.equal(result.ok, false);
  });

  it("rejects invalid color", () => {
    const result = validateBrandInput({ name: "X", background: "notacolor" });
    assert.equal(result.ok, false);
  });

  it("rejects invalid palette entry", () => {
    const result = validateBrandInput({
      name: "X",
      palette: ["#ff0000", "bad"],
    });
    assert.equal(result.ok, false);
  });

  it("accepts null fields for optional colors", () => {
    const result = validateBrandInput({
      name: "Minimal",
      background: null,
      nodeFill: null,
    });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// parsePalette
// ---------------------------------------------------------------------------

describe("parsePalette", () => {
  it("returns null for non-array", () =>
    assert.equal(parsePalette("bad"), null));
  it("returns null for empty array", () =>
    assert.equal(parsePalette([]), null));
  it("returns null for invalid color in array", () =>
    assert.equal(parsePalette(["#f00", "bad"]), null));
  it("accepts valid palette", () => {
    assert.deepEqual(parsePalette(["#ff0000"]), ["#ff0000"]);
  });
  it("accepts CSS hex lengths and rejects unsupported 5- and 7-digit colors", () => {
    assert.deepEqual(parsePalette(["#abc", "#abcd", "#abcdef", "#abcdef12"]), [
      "#abc",
      "#abcd",
      "#abcdef",
      "#abcdef12",
    ]);
    assert.equal(parsePalette(["#12345"]), null);
    assert.equal(parsePalette(["#1234567"]), null);

    assert.equal(
      validateBrandInput({ name: "Invalid background", background: "#12345" })
        .ok,
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// validateFontUpload
// ---------------------------------------------------------------------------

describe("validateFontUpload", () => {
  it("accepts woff2", () => {
    const r = validateFontUpload("font/woff2", "my.woff2", 1024);
    assert.equal(r.ok, true);
  });

  it("rejects oversized file", () => {
    const r = validateFontUpload(
      "font/woff2",
      "my.woff2",
      BRAND_FONT_MAX_BYTES + 1,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "file_too_large");
  });

  it("rejects wrong type", () => {
    const r = validateFontUpload("image/png", "my.png", 100);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "type_rejected");
  });

  it("resolves type from extension for octet-stream", () => {
    const r = validateFontUpload("application/octet-stream", "my.woff2", 100);
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// validateLogoUpload
// ---------------------------------------------------------------------------

describe("validateLogoUpload", () => {
  it("accepts png", () => {
    const r = validateLogoUpload("image/png", "logo.png", 1024);
    assert.equal(r.ok, true);
  });

  it("rejects svg", () => {
    const r = validateLogoUpload("image/svg+xml", "logo.svg", 512);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "type_rejected");
  });

  it("rejects oversized file", () => {
    const r = validateLogoUpload(
      "image/png",
      "logo.png",
      BRAND_LOGO_MAX_BYTES + 1,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "file_too_large");
  });

  it("rejects font as logo", () => {
    const r = validateLogoUpload("font/woff2", "x.woff2", 100);
    assert.equal(r.ok, false);
  });
});
