import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DiagnosticCollector,
  categoryForDiagnosticCode,
  diagnosticTargetKey,
  diagnosticTargetLabel,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
  makeDiagnostic,
  retargetDiagnostic,
} from "./diagnostics";

test("diagnostics infer every target scope and collector severity helpers", () => {
  const theme = makeDiagnostic(
    "unknown-theme-package",
    "error",
    "Unknown theme",
    {
      details: { themePackageId: "theme-1" },
      slideId: "slide-1",
      path: "theme",
    },
  );
  const decoration = makeDiagnostic(
    "missing-decoration",
    "warning",
    "Missing decoration",
    { details: { themePackageId: "theme-1" } },
  );
  const style = makeDiagnostic(
    "unknown-style-ref",
    "warning",
    "Unknown style",
    { details: { styleRef: "text.missing" }, nodeId: "node-1" },
  );
  const node = makeDiagnostic("invalid-node-layout", "error", "Bad layout", {
    nodeId: "node-1",
    slideId: "slide-1",
  });
  const slide = makeDiagnostic("slot-over-capacity", "warning", "Too much", {
    slideId: "slide-1",
  });
  const source = makeDiagnostic(
    "missing-source-block",
    "warning",
    "Missing source",
    { details: { documentId: "doc-1", blockId: "block-1" } },
  );
  const asset = makeDiagnostic(
    "invalid-asset-reference",
    "error",
    "Bad asset",
    { details: { assetId: "asset-1" }, nodeId: "node-1" },
  );
  const exportDiagnostic = makeDiagnostic(
    "theme-decoration-export-fallback",
    "warning",
    "Fallback",
    { details: { exportFeature: "decorations" } },
  );

  assert.equal(diagnosticTargetKey(theme.target), "theme:theme-1");
  assert.equal(diagnosticTargetLabel(theme.target), "Theme theme-1");
  assert.equal(diagnosticTargetLabel(decoration.target), "Theme theme-1");
  assert.equal(diagnosticTargetKey(style.target), "style:text.missing");
  assert.equal(diagnosticTargetLabel(style.target), "Style text.missing");
  assert.equal(diagnosticTargetLabel(node.target), "Node node-1");
  assert.equal(diagnosticTargetLabel(slide.target), "Slide slide-1");
  assert.equal(diagnosticTargetLabel(source.target), "Source block block-1");
  assert.equal(diagnosticTargetLabel(asset.target), "Asset asset-1");
  assert.equal(
    diagnosticTargetLabel(exportDiagnostic.target),
    "Export decorations",
  );
  assert.equal(getDiagnosticSlideId(theme), "slide-1");
  assert.equal(getDiagnosticNodeId(asset), "node-1");

  const withExplicitTarget = makeDiagnostic(
    "duplicate-id",
    "info",
    "Duplicate",
    {
      target: { scope: "deck", label: "Whole deck" },
      action: {
        type: "split-slide",
        target: { scope: "slide", slideId: "slide-1" },
      },
    },
  );
  assert.equal(withExplicitTarget.action?.target?.scope, "slide");
  assert.equal(diagnosticTargetLabel(withExplicitTarget.target), "Whole deck");

  const retargeted = retargetDiagnostic(style, {
    slideId: "slide-2",
    nodeId: "node-2",
    path: "slides[1].children[0]",
  });
  assert.equal(retargeted.target.scope, "style");
  assert.equal(retargeted.slideId, "slide-2");
  assert.equal(retargeted.nodeId, "node-2");

  const collector = new DiagnosticCollector();
  collector.info("duplicate-id", "Info");
  collector.warning("missing-token", "Warning");
  assert.equal(collector.hasErrors(), false);
  collector.error("invalid-node-layout", "Error");
  assert.equal(collector.hasErrors(), true);
  collector.fatal("invalid-schema-version", "Fatal");
  assert.equal(collector.hasFatal(), true);
});

test("diagnostic labels and keys fall back across optional identifiers", () => {
  const targets = [
    { scope: "asset" as const, nodeId: "node-1" },
    { scope: "asset" as const, path: "assets.hero" },
    { scope: "source" as const, documentId: "doc-1" },
    { scope: "source" as const, nodeId: "node-1" },
    { scope: "style" as const, nodeId: "node-1" },
    { scope: "theme" as const, slideId: "slide-1" },
    { scope: "export" as const, nodeId: "node-1" },
    { scope: "export" as const, slideId: "slide-1" },
  ];
  assert.deepEqual(targets.map(diagnosticTargetKey), [
    "asset:node-1",
    "asset:assets.hero",
    "source:doc-1:deck",
    "source::node-1",
    "style:node-1",
    "theme:slide-1",
    "export:node-1",
    "export:slide-1",
  ]);
  assert.equal(diagnosticTargetLabel({ scope: "asset" }), "Asset");
  assert.equal(diagnosticTargetLabel({ scope: "source" }), "Source");
  assert.equal(diagnosticTargetLabel({ scope: "style" }), "Style");
  assert.equal(diagnosticTargetLabel({ scope: "theme" }), "Theme package");
  assert.equal(diagnosticTargetLabel({ scope: "export" }), "Export");

  const sourceWithoutDetails = makeDiagnostic(
    "stale-source",
    "warning",
    "Stale",
    { path: "source.path" },
  );
  const assetWithoutDetails = makeDiagnostic(
    "missing-asset",
    "warning",
    "Missing",
    { path: "asset.path" },
  );
  const nodeOnly = makeDiagnostic("invalid-node-layout", "error", "Bad", {
    nodeId: "node-1",
  });
  assert.equal(sourceWithoutDetails.target.scope, "source");
  assert.equal(assetWithoutDetails.target.scope, "asset");
  assert.equal(nodeOnly.target.scope, "node");
});

test("diagnostic category mapping covers render and validation fallback codes", () => {
  assert.equal(categoryForDiagnosticCode("missing-node-layout"), "render");
  assert.equal(categoryForDiagnosticCode("invalid-text-runs"), "render");
  assert.equal(categoryForDiagnosticCode("invalid-table-shape"), "render");
  assert.equal(
    categoryForDiagnosticCode("unknown-template-kind"),
    "validation",
  );
  const withNumberDetails = makeDiagnostic(
    "unknown-theme-package",
    "warning",
    "Theme",
    { details: { themePackageId: 7 } as never },
  );
  assert.equal(withNumberDetails.target.scope, "theme");
});
