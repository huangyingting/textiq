import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  categoryForDiagnosticCode,
  diagnosticTargetLabel,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
  groupDiagnostics,
  makeDiagnostic,
} from "./diagnostics";

import type { DiagnosticAction } from "./diagnostics";

describe("presentation diagnostics model", () => {
  test("derives stable categories and targets for existing producers", () => {
    const missingAsset = makeDiagnostic(
      "missing-asset",
      "error",
      "Image asset missing",
      {
        slideId: "slide-1",
        nodeId: "image-1",
        details: { assetId: "asset-1" },
        action: { type: "open-asset-panel" },
      },
    );
    const exportFallback = makeDiagnostic(
      "unsupported-export-feature",
      "warning",
      "Blur fallback",
      { nodeId: "shape-1", action: { type: "replace-style-ref" } },
    );

    assert.equal(missingAsset.category, "asset");
    assert.equal(missingAsset.target.scope, "asset");
    assert.equal(missingAsset.action?.target?.scope, "asset");
    assert.equal(getDiagnosticSlideId(missingAsset), "slide-1");
    assert.equal(getDiagnosticNodeId(missingAsset), "image-1");
    assert.equal(exportFallback.category, "export");
    assert.equal(exportFallback.target.scope, "export");
  });

  test("declares source and validation categories for shared diagnostics", () => {
    assert.equal(categoryForDiagnosticCode("stale-source"), "source");
    assert.equal(categoryForDiagnosticCode("orphaned-source"), "source");
    assert.equal(categoryForDiagnosticCode("duplicate-id"), "validation");
  });

  test("classifies theme decoration diagnostics and infers source targets", () => {
    const missingDecoration = makeDiagnostic(
      "missing-decoration",
      "warning",
      "Decoration disabled outside the theme package",
      {
        slideId: "slide-1",
        action: {
          type: "restore-decoration",
          payload: { decorationId: "bg-corner" },
        },
      },
    );
    const staleSource = makeDiagnostic(
      "stale-source",
      "warning",
      "Source content is stale",
      {
        slideId: "slide-1",
        nodeId: "text-1",
        path: "slides.0.children.0.source",
        details: { documentId: "doc-1", blockId: "block-1" },
        action: { type: "open-source-review" },
      },
    );

    assert.equal(missingDecoration.category, "theme");
    assert.equal(missingDecoration.target.scope, "theme");
    assert.equal(missingDecoration.action?.target?.scope, "theme");
    assert.equal(staleSource.category, "source");
    assert.equal(staleSource.target.scope, "source");
    assert.equal(staleSource.action?.target?.scope, "source");
    assert.equal(getDiagnosticSlideId(staleSource), "slide-1");
    assert.equal(getDiagnosticNodeId(staleSource), "text-1");
  });

  test("groups diagnostics by target scope then sorts by severity", () => {
    const diagnostics = [
      makeDiagnostic("missing-token", "warning", "Token missing", {
        path: "styles.text.body.color",
      }),
      makeDiagnostic("missing-asset", "fatal", "Asset missing", {
        slideId: "slide-2",
        nodeId: "image-2",
        details: { assetId: "hero" },
        action: { type: "open-asset-panel" },
      }),
      makeDiagnostic("missing-asset", "warning", "Asset has fallback", {
        slideId: "slide-2",
        nodeId: "image-2",
        details: { assetId: "hero" },
      }),
      makeDiagnostic("duplicate-id", "info", "Duplicate id"),
    ];

    const groups = groupDiagnostics(diagnostics);
    assert.equal(groups[0].scope, "asset");
    assert.equal(groups[0].diagnostics.length, 2);
    assert.equal(groups[0].severity, "fatal");
    assert.equal(groups[1].scope, "style");
    assert.equal(groups[2].scope, "deck");
    assert.equal(diagnosticTargetLabel(groups[0].target), "Asset hero");
  });

  test("diagnostic actions are typed payload objects", () => {
    const action: DiagnosticAction = {
      type: "choose-denser-layout",
      payload: { density: "dense" },
    };
    const diagnostic = makeDiagnostic(
      "slot-over-capacity",
      "warning",
      "Too much content",
      { slideId: "slide-1", action },
    );

    assert.equal(diagnostic.action?.type, "choose-denser-layout");
    assert.deepEqual(diagnostic.action?.payload, { density: "dense" });
    assert.equal(diagnostic.action?.target?.scope, "slide");
  });
});
