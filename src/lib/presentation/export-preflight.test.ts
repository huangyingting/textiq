import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import { buildExportSpec } from "@/lib/presentation/export-spec";
import {
  buildPresentationExportPreflight,
  type PresentationExportFormat,
} from "@/lib/presentation/export-preflight";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import {
  buildMinimalDeck,
  buildMinimalThemePackage,
} from "@/test/builders/presentation-deck";

function buildCleanFixture() {
  const deck = buildMinimalDeck();
  const renderTree = resolveDeckRenderTree(deck, buildMinimalThemePackage());
  return { deck, renderTree };
}

describe("buildPresentationExportPreflight", () => {
  test("classifies error diagnostics as fatal blockers", () => {
    const { deck, renderTree } = buildCleanFixture();
    const result = buildPresentationExportPreflight({
      deck,
      renderTree,
      format: "pdf",
      buildSpec: () => ({
        ...buildExportSpec(renderTree),
        diagnostics: [
          makeDiagnostic(
            "missing-asset",
            "error",
            'Image node "image-1" references missing asset "missing"',
          ),
          makeDiagnostic(
            "unsupported-export-feature",
            "warning",
            "A fidelity fallback will be used",
          ),
        ],
      }),
    });

    assert.equal(result.label, "PDF");
    assert.equal(result.hasFatal, true);
    assert.equal(result.canExport, false);
    assert.equal(result.fatalDiagnostics.length, 1);
    assert.equal(result.warningDiagnostics.length, 1);
  });

  test("keeps clean raster exports exportable with the raster tier", () => {
    const { deck, renderTree } = buildCleanFixture();
    const result = buildPresentationExportPreflight({
      deck,
      renderTree,
      format: "png",
    });

    assert.equal(result.canExport, true);
    assert.equal(result.hasWarnings, false);
    assert.deepEqual(result.fallbackTiers, ["raster"]);
  });

  test("tracks format-specific PPTX fallback tiers", () => {
    const { deck, renderTree } = buildCleanFixture();
    const result = buildPresentationExportPreflight({
      deck,
      renderTree,
      format: "pptx" satisfies PresentationExportFormat,
      buildSpec: () => ({
        ...buildExportSpec(renderTree),
        diagnostics: [
          makeDiagnostic(
            "unsupported-export-feature",
            "warning",
            "Shape effect uses image retry",
            {
              details: { exportFeature: "pptx-effect-image-retry" },
            },
          ),
        ],
      }),
    });

    assert.equal(result.canExport, true);
    assert.equal(result.hasWarnings, true);
    assert.deepEqual(result.fallbackTiers, ["image-retry"]);
  });
});
