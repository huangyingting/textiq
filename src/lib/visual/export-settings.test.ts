/**
 * Direct contracts for `createDefaultExportDialogOptions` (#1949), the glue
 * between the billing-derived {@link ExportPolicy} and the transient export
 * dialog's option defaults.
 *
 * `resolveExportPolicy` (export-policy.ts) and `DEFAULT_EXPORT_OPTIONS`
 * (export-options.ts) already have their own coverage; this file exercises
 * only what `export-settings.ts` adds on top: deriving `watermark` from the
 * caller's real entitlement input via the production policy resolver, while
 * every other export option stays pinned to its default.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createDefaultExportDialogOptions } from "@/lib/visual/export-settings";
import { resolveExportPolicy } from "@/lib/visual/export-policy";
import { DEFAULT_EXPORT_OPTIONS } from "@/lib/visual/export-options";

test("free-tier entitlements (no removeWatermark) default the dialog to watermark: true", () => {
  const policy = resolveExportPolicy({
    svgExport: false,
    pptxExport: false,
    removeWatermark: false,
  });

  const options = createDefaultExportDialogOptions(policy);

  assert.equal(options.watermark, true);
});

test("removeWatermark entitlement defaults the dialog to watermark: false", () => {
  const policy = resolveExportPolicy({
    svgExport: true,
    pptxExport: true,
    removeWatermark: true,
  });

  const options = createDefaultExportDialogOptions(policy);

  assert.equal(options.watermark, false);
});

test("svg/pptx entitlements alone (without removeWatermark) still default to watermark: true", () => {
  const policy = resolveExportPolicy({
    svgExport: true,
    pptxExport: true,
    removeWatermark: false,
  });

  const options = createDefaultExportDialogOptions(policy);

  assert.equal(
    options.watermark,
    true,
    "watermark default should track only canRemoveWatermark, not the other entitlements",
  );
});

test("missing entitlements resolve through the free-tier fallback to watermark: true", () => {
  const policy = resolveExportPolicy(undefined);

  const options = createDefaultExportDialogOptions(policy);

  assert.equal(options.watermark, true);
});

test("every non-watermark field stays pinned to DEFAULT_EXPORT_OPTIONS regardless of policy", () => {
  const paidOptions = createDefaultExportDialogOptions(
    resolveExportPolicy({
      svgExport: true,
      pptxExport: true,
      removeWatermark: true,
    }),
  );
  const freeOptions = createDefaultExportDialogOptions(
    resolveExportPolicy({
      svgExport: false,
      pptxExport: false,
      removeWatermark: false,
    }),
  );

  for (const options of [paidOptions, freeOptions]) {
    assert.equal(options.background, DEFAULT_EXPORT_OPTIONS.background);
    assert.equal(options.colorMode, DEFAULT_EXPORT_OPTIONS.colorMode);
    assert.equal(options.scale, DEFAULT_EXPORT_OPTIONS.scale);
    assert.equal(options.aspectRatio, undefined);
    assert.equal(options.socialPreset, undefined);
  }
});

test("each call returns a fresh object without mutating the shared DEFAULT_EXPORT_OPTIONS", () => {
  assert.equal(
    "watermark" in DEFAULT_EXPORT_OPTIONS,
    false,
    "DEFAULT_EXPORT_OPTIONS has no watermark field before any call",
  );

  const free = createDefaultExportDialogOptions(
    resolveExportPolicy({
      svgExport: false,
      pptxExport: false,
      removeWatermark: false,
    }),
  );
  const paid = createDefaultExportDialogOptions(
    resolveExportPolicy({
      svgExport: false,
      pptxExport: false,
      removeWatermark: true,
    }),
  );

  assert.notEqual(free, paid, "each call should produce a distinct object");
  assert.equal(free.watermark, true);
  assert.equal(paid.watermark, false);
  assert.equal(
    "watermark" in DEFAULT_EXPORT_OPTIONS,
    false,
    "the shared default constant must remain untouched by either call",
  );
});
