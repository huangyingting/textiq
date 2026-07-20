import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyAspectRatioToSvg,
  applyExportOptionsToSvg,
  applySocialPresetToOptions,
  clearSocialPreset,
  computeExportDimensions,
  computeLetterboxedDimensions,
  DEFAULT_EXPORT_OPTIONS,
  getOutputProfile,
  listOutputProfiles,
  SOCIAL_PRESET_CONFIGS,
  type ExportOptions,
} from "@/lib/visual/export-options";
import { OUTPUT_PROFILE_CATALOG } from "@/lib/visual/output-profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><rect x="0" y="0" width="800" height="600" fill="#ffffff"/><circle cx="400" cy="300" r="50" fill="#6366f1"/></svg>`;
const BASE_SVG_NO_BG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><circle cx="400" cy="300" r="50" fill="#6366f1"/></svg>`;
const BASE_SVG_WITH_DEFS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><marker id="m1"/></defs><circle cx="400" cy="300" r="50" fill="#6366f1"/></svg>`;

function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS, ...overrides };
}

// ---------------------------------------------------------------------------
// computeExportDimensions
// ---------------------------------------------------------------------------

test("DEFAULT_EXPORT_OPTIONS remains stable for existing callers", () => {
  assert.deepEqual(DEFAULT_EXPORT_OPTIONS, {
    background: "include",
    colorMode: "color",
    scale: 2,
  });
});

test("output profile catalog owns social preset ordering and metadata", () => {
  assert.deepEqual(
    OUTPUT_PROFILE_CATALOG.map((profile) => profile.id),
    ["square", "portrait", "landscape", "story"],
  );
  assert.equal(OUTPUT_PROFILE_CATALOG[0], SOCIAL_PRESET_CONFIGS.square);
  assert.equal(getOutputProfile("story").background, "#000000");
  assert.deepEqual(
    listOutputProfiles().map((profile) => profile.canonicalHeight),
    [1080, 1350, 675, 1920],
  );
});

test("computeExportDimensions: 1x returns natural dimensions", () => {
  const dims = computeExportDimensions({ width: 800, height: 600 }, 1);
  assert.deepEqual(dims, { width: 800, height: 600 });
});

test("computeExportDimensions: 2x doubles both dimensions", () => {
  const dims = computeExportDimensions({ width: 400, height: 300 }, 2);
  assert.deepEqual(dims, { width: 800, height: 600 });
});

test("computeExportDimensions: 3x triples both dimensions", () => {
  const dims = computeExportDimensions({ width: 100, height: 50 }, 3);
  assert.deepEqual(dims, { width: 300, height: 150 });
});

test("computeExportDimensions: fractional scale rounds to integer", () => {
  const dims = computeExportDimensions({ width: 300, height: 200 }, 1.5);
  assert.equal(dims.width, 450);
  assert.equal(dims.height, 300);
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — background: include (no-op)
// ---------------------------------------------------------------------------

test("background include: SVG is unchanged (no background transform applied)", () => {
  const opts = makeOptions({ background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG, opts);
  // Existing background rect should still be present
  assert.ok(
    result.includes('fill="#ffffff"'),
    "background rect fill should be preserved",
  );
  // Core content should still be present
  assert.ok(result.includes("#6366f1"), "content fill should be preserved");
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — background: transparent
// ---------------------------------------------------------------------------

test("background transparent: strips a leading background rect", () => {
  const opts = makeOptions({ background: "transparent", colorMode: "color" });
  const result = applyExportOptionsToSvg(BASE_SVG, opts);
  assert.ok(
    !result.includes('fill="#ffffff"'),
    "full-viewBox background rect should be removed",
  );
  // The white background rect should be gone; the content circle should remain
  assert.ok(
    result.includes("#6366f1"),
    "content circle should still be present",
  );
  // The SVG root should still be present
  assert.ok(result.includes("<svg"), "svg element should still be present");
  assert.ok(
    result.includes("</svg>"),
    "svg closing tag should still be present",
  );
});

test("background transparent: SVG without background rect is unchanged", () => {
  const opts = makeOptions({ background: "transparent", colorMode: "color" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(result.includes("#6366f1"), "content fill should still be present");
  assert.ok(result.includes("<svg"), "svg element should still be present");
});

test("background transparent: preserves a data rect that starts on an axis", () => {
  const opts = makeOptions({ background: "transparent", colorMode: "color" });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect x="0" y="0" width="120" height="600" fill="#ef4444" data-point-id="bar-1"/><circle cx="400" cy="300" r="50" fill="#6366f1"/></svg>`;
  const result = applyExportOptionsToSvg(svg, opts);

  assert.ok(
    result.includes('data-point-id="bar-1"'),
    "chart data rect at x=0/y=0 must be preserved",
  );
  assert.ok(result.includes("#ef4444"), "chart data fill should remain");
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — background: custom
// ---------------------------------------------------------------------------

test("background custom: injects a background rect with the custom fill", () => {
  const opts = makeOptions({
    background: "custom",
    customBackground: "#ff0000",
    colorMode: "color",
  });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    result.includes('fill="#ff0000"'),
    "custom background fill should be injected",
  );
  assert.ok(
    result.includes('data-export-bg="true"'),
    "injected rect should carry the marker attribute",
  );
});

test("background custom: default fallback is white when customBackground is omitted", () => {
  const opts = makeOptions({ background: "custom", colorMode: "color" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    result.includes('fill="#ffffff"'),
    "fallback white background should be injected",
  );
});

test("background custom: injected rect dimensions match viewBox", () => {
  const opts = makeOptions({
    background: "custom",
    customBackground: "#0000ff",
    colorMode: "color",
  });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  // The rect should use the viewBox dimensions (800 x 600)
  assert.ok(result.includes('width="800"'), "rect width should match viewBox");
  assert.ok(
    result.includes('height="600"'),
    "rect height should match viewBox",
  );
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — colorMode: mono
// ---------------------------------------------------------------------------

test("colorMode mono: injects a greyscale feColorMatrix filter", () => {
  const opts = makeOptions({ colorMode: "mono", background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    result.includes("feColorMatrix"),
    "feColorMatrix filter element should be injected",
  );
  assert.ok(
    result.includes('type="saturate"'),
    "feColorMatrix should use saturate type",
  );
  assert.ok(
    result.includes('values="0"'),
    "feColorMatrix should have values=0 for greyscale",
  );
});

test("colorMode mono: wraps content in a filter group", () => {
  const opts = makeOptions({ colorMode: "mono", background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    result.includes('filter="url(#__export_mono__)"'),
    "content should be wrapped in a mono filter group",
  );
});

test("colorMode mono: inserts filter into existing <defs>", () => {
  const opts = makeOptions({ colorMode: "mono", background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG_WITH_DEFS, opts);
  // Should NOT create a second <defs> block
  const defsCount = (result.match(/<defs/g) ?? []).length;
  assert.equal(defsCount, 1, "should reuse existing <defs> block");
  assert.ok(
    result.includes("feColorMatrix"),
    "filter should be injected inside existing <defs>",
  );
});

test("colorMode mono: creates <defs> when none exists", () => {
  const opts = makeOptions({ colorMode: "mono", background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(result.includes("<defs>"), "defs block should be created");
});

test("colorMode color (default): no filter is injected", () => {
  const opts = makeOptions({ colorMode: "color", background: "include" });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    !result.includes("feColorMatrix"),
    "no filter should be injected for color mode",
  );
  assert.ok(
    !result.includes("__export_mono__"),
    "mono filter id should not be present",
  );
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — combined options
// ---------------------------------------------------------------------------

test("transparent + mono: applies both transforms correctly", () => {
  const opts = makeOptions({ background: "transparent", colorMode: "mono" });
  const result = applyExportOptionsToSvg(BASE_SVG, opts);
  // Background rect should be stripped
  assert.ok(
    result.includes("#6366f1"),
    "content circle should still be present after background strip",
  );
  // Mono filter should be applied
  assert.ok(result.includes("feColorMatrix"), "mono filter should be applied");
});

test("custom bg + mono: injects both background rect and mono filter", () => {
  const opts = makeOptions({
    background: "custom",
    customBackground: "#cccccc",
    colorMode: "mono",
  });
  const result = applyExportOptionsToSvg(BASE_SVG_NO_BG, opts);
  assert.ok(
    result.includes('fill="#cccccc"'),
    "custom background should be injected",
  );
  assert.ok(result.includes("feColorMatrix"), "mono filter should be injected");
});

// ---------------------------------------------------------------------------
// computeLetterboxedDimensions — 9:16 ratio
// ---------------------------------------------------------------------------

test("computeLetterboxedDimensions: 9:16 pillarboxes a landscape canvas", () => {
  // 800×600 is landscape (wider than 9:16), so height must be extended
  const { canvasW, canvasH, offsetX, offsetY } = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "9:16",
  );
  assert.equal(canvasW, 800, "canvasW should match the content width");
  assert.ok(
    canvasH > 600,
    "canvasH should be greater than the content height for 9:16",
  );
  assert.equal(offsetX, 0, "no horizontal offset for pillarbox");
  assert.ok(offsetY > 0, "vertical offset should center content");
  // Verify ratio
  const ratio = canvasW / canvasH;
  assert.ok(Math.abs(ratio - 9 / 16) < 0.001, "canvas ratio should be 9:16");
});

test("computeLetterboxedDimensions: 9:16 letterboxes a portrait canvas", () => {
  // 400×800 is portrait (taller than 9:16 at 0.5 vs 0.5625)
  // 400/800 = 0.5, 9/16 = 0.5625 → content is taller than target
  // Actually 9/16 ≈ 0.5625 and 400/800 = 0.5, so content is narrower → extend width
  const { canvasW, canvasH, offsetX, offsetY } = computeLetterboxedDimensions(
    { width: 400, height: 800 },
    "9:16",
  );
  // 9:16 ratio is 0.5625; content ratio is 0.5 (narrower)
  // → extend width: canvasH = 800, canvasW = 800 * (9/16)
  assert.equal(canvasH, 800, "canvasH should match the content height");
  assert.ok(canvasW > 400, "canvasW should be greater than the content width");
  assert.equal(offsetY, 0, "no vertical offset for letterbox");
  assert.ok(offsetX > 0, "horizontal offset should center content");
  const ratio = canvasW / canvasH;
  assert.ok(Math.abs(ratio - 9 / 16) < 0.001, "canvas ratio should be 9:16");
});

// ---------------------------------------------------------------------------
// computeLetterboxedDimensions — safe-area padding
// ---------------------------------------------------------------------------

test("computeLetterboxedDimensions: padding=0 matches no-padding behaviour", () => {
  const withPad = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "1:1",
    0,
  );
  const withoutPad = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "1:1",
  );
  assert.deepEqual(withPad, withoutPad);
});

test("computeLetterboxedDimensions returns natural dimensions for auto or missing presets", () => {
  assert.deepEqual(
    computeLetterboxedDimensions({ width: 320, height: 180 }, undefined),
    {
      canvasW: 320,
      canvasH: 180,
      offsetX: 0,
      offsetY: 0,
    },
  );
  assert.deepEqual(
    computeLetterboxedDimensions({ width: 320, height: 180 }, "auto"),
    {
      canvasW: 320,
      canvasH: 180,
      offsetX: 0,
      offsetY: 0,
    },
  );
});

test("computeLetterboxedDimensions preserves an already matching padded aspect", () => {
  assert.deepEqual(
    computeLetterboxedDimensions({ width: 100, height: 100 }, "1:1"),
    {
      canvasW: 100,
      canvasH: 100,
      offsetX: 0,
      offsetY: 0,
    },
  );
});

test("applyAspectRatioToSvg returns unchanged SVG for auto, missing viewBox, and matching ratios", () => {
  assert.equal(applyAspectRatioToSvg(BASE_SVG, "auto"), BASE_SVG);
  const noViewBox = `<svg><circle cx="1" cy="1" r="1"/></svg>`;
  assert.equal(applyAspectRatioToSvg(noViewBox, "1:1"), noViewBox);

  const squareSvg = `<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`;
  assert.equal(applyAspectRatioToSvg(squareSvg, "1:1"), squareSvg);
});

test("computeLetterboxedDimensions: padding produces larger canvas than without padding", () => {
  const pad = 40;
  const { canvasW: cWpad, canvasH: cHpad } = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "1:1",
    pad,
  );
  const { canvasW: cWno, canvasH: cHno } = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "1:1",
  );
  assert.ok(
    cWpad > cWno || cHpad > cHno,
    "padded canvas must be larger in at least one dimension",
  );
});

test("computeLetterboxedDimensions: padding centers content with at least padding-unit margin", () => {
  const pad = 50;
  const vbW = 800;
  const vbH = 600;
  const { canvasW, canvasH, offsetX, offsetY } = computeLetterboxedDimensions(
    { width: vbW, height: vbH },
    "1:1",
    pad,
  );
  // Content occupies [offsetX, offsetX + vbW] × [offsetY, offsetY + vbH]
  const leftMargin = offsetX;
  const rightMargin = canvasW - (offsetX + vbW);
  const topMargin = offsetY;
  const bottomMargin = canvasH - (offsetY + vbH);
  assert.ok(
    leftMargin >= pad - 0.001,
    `left margin (${leftMargin}) should be >= padding (${pad})`,
  );
  assert.ok(
    rightMargin >= pad - 0.001,
    `right margin (${rightMargin}) should be >= padding (${pad})`,
  );
  assert.ok(
    topMargin >= pad - 0.001,
    `top margin (${topMargin}) should be >= padding (${pad})`,
  );
  assert.ok(
    bottomMargin >= pad - 0.001,
    `bottom margin (${bottomMargin}) should be >= padding (${pad})`,
  );
});

test("computeLetterboxedDimensions: padded canvas maintains target aspect ratio", () => {
  const { canvasW, canvasH } = computeLetterboxedDimensions(
    { width: 800, height: 600 },
    "16:9",
    40,
  );
  const ratio = canvasW / canvasH;
  assert.ok(
    Math.abs(ratio - 16 / 9) < 0.001,
    `padded canvas ratio (${ratio}) should equal 16:9`,
  );
});

// ---------------------------------------------------------------------------
// applySocialPresetToOptions
// ---------------------------------------------------------------------------

test("applySocialPresetToOptions: square sets 1:1 ratio with padding and white background", () => {
  const result = applySocialPresetToOptions("square", DEFAULT_EXPORT_OPTIONS);
  assert.equal(result.aspectRatio, "1:1");
  assert.equal(result.background, "custom");
  assert.equal(result.customBackground, "#ffffff");
  assert.ok(
    typeof result.padding === "number" && result.padding > 0,
    "padding should be positive",
  );
  assert.equal(result.socialPreset, "square");
  assert.ok(
    result.scale >= SOCIAL_PRESET_CONFIGS.square.minScale,
    "scale should be at least minScale",
  );
});

test("applySocialPresetToOptions: portrait sets 4:5 ratio", () => {
  const result = applySocialPresetToOptions("portrait", DEFAULT_EXPORT_OPTIONS);
  assert.equal(result.aspectRatio, "4:5");
  assert.equal(result.socialPreset, "portrait");
});

test("applySocialPresetToOptions: landscape sets 16:9 ratio", () => {
  const result = applySocialPresetToOptions(
    "landscape",
    DEFAULT_EXPORT_OPTIONS,
  );
  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.socialPreset, "landscape");
});

test("applySocialPresetToOptions: story sets 9:16 ratio with black background", () => {
  const result = applySocialPresetToOptions("story", DEFAULT_EXPORT_OPTIONS);
  assert.equal(result.aspectRatio, "9:16");
  assert.equal(result.customBackground, "#000000");
  assert.equal(result.socialPreset, "story");
});

test("applySocialPresetToOptions: raises scale to minScale when current scale is lower", () => {
  const lowScaleOpts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, scale: 1 };
  const result = applySocialPresetToOptions("square", lowScaleOpts);
  assert.ok(
    result.scale >= SOCIAL_PRESET_CONFIGS.square.minScale,
    "scale should be raised to at least minScale",
  );
});

test("applySocialPresetToOptions: preserves scale when already above minScale", () => {
  const highScaleOpts: ExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    scale: 3,
  };
  const result = applySocialPresetToOptions("square", highScaleOpts);
  assert.equal(result.scale, 3, "scale above minScale should be preserved");
});

test("applySocialPresetToOptions: preserves colorMode and watermark", () => {
  const opts: ExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    colorMode: "mono",
    watermark: true,
  };
  const result = applySocialPresetToOptions("portrait", opts);
  assert.equal(result.colorMode, "mono");
  assert.equal(result.watermark, true);
});

// ---------------------------------------------------------------------------
// clearSocialPreset
// ---------------------------------------------------------------------------

test("clearSocialPreset: removes socialPreset, aspectRatio, and padding", () => {
  const preset = applySocialPresetToOptions("square", DEFAULT_EXPORT_OPTIONS);
  const cleared = clearSocialPreset(preset);
  assert.equal(cleared.socialPreset, undefined);
  assert.equal(cleared.aspectRatio, undefined);
  assert.equal(cleared.padding, undefined);
});

test("clearSocialPreset: preserves other options", () => {
  const opts: ExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    colorMode: "mono",
    background: "custom",
    customBackground: "#aabbcc",
  };
  const preset = applySocialPresetToOptions("square", opts);
  const cleared = clearSocialPreset(preset);
  assert.equal(cleared.colorMode, "mono");
  // background was set to "custom" by preset so it stays custom after clear
  assert.equal(cleared.background, "custom");
});

// ---------------------------------------------------------------------------
// applyExportOptionsToSvg — social preset with padding
// ---------------------------------------------------------------------------

test("aspectRatio + padding: letterbox rect covers full canvas with padding", () => {
  const opts = makeOptions({
    aspectRatio: "1:1",
    padding: 40,
    background: "include",
  });
  const result = applyExportOptionsToSvg(BASE_SVG, opts);
  // The letterbox rect should have been injected
  assert.ok(
    result.includes('data-letterbox="true"'),
    "letterbox background rect should be injected",
  );
  // Canvas should be square and larger than the original 800×600 content
  const vbMatch = result.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
  assert.ok(vbMatch, "updated viewBox should be present");
  const cW = parseFloat(vbMatch![1]);
  const cH = parseFloat(vbMatch![2]);
  assert.ok(
    cW > 800,
    `canvas width (${cW}) should be > original content width (800) due to padding`,
  );
  assert.ok(Math.abs(cW / cH - 1) < 0.001, "canvas should be 1:1 (square)");
});

test("aspectRatio 9:16 + padding: creates a portrait canvas", () => {
  const opts = makeOptions({
    aspectRatio: "9:16",
    padding: 48,
    background: "include",
  });
  const result = applyExportOptionsToSvg(BASE_SVG, opts);
  assert.ok(
    result.includes('data-letterbox="true"'),
    "letterbox should be applied",
  );
  const vbMatch = result.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
  assert.ok(vbMatch, "updated viewBox should be present");
  const cW = parseFloat(vbMatch![1]);
  const cH = parseFloat(vbMatch![2]);
  const ratio = cW / cH;
  assert.ok(
    Math.abs(ratio - 9 / 16) < 0.001,
    `canvas ratio (${ratio}) should be 9:16`,
  );
});
