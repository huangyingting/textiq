import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  diagnosticActionDescriptor,
  sourceReviewActionDescriptor,
} from "./review-action-descriptors";

describe("review action descriptors", () => {
  test("describes diagnostic repair labels and eligibility", () => {
    const refresh = diagnosticActionDescriptor({ type: "refresh-source" });
    const unlink = diagnosticActionDescriptor("unlink-source");
    const assetPanel = diagnosticActionDescriptor("open-asset-panel");
    const split = diagnosticActionDescriptor("split-slide");

    assert.equal(refresh.label, "Refresh source");
    assert.equal(refresh.repairEligibility, "source-review");
    assert.equal(refresh.safety, "safe");
    assert.equal(unlink.safety, "safe-destructive");
    assert.equal(assetPanel.repairEligibility, "host-action");
    assert.equal(split.repairEligibility, "direct-repair");
    assert.equal(split.severity, "warning");
  });

  test("describes source review disabled reasons without changing safe repair behavior", () => {
    const staleRefresh = sourceReviewActionDescriptor("refresh-source-link", {
      item: { state: "stale" },
    });
    const orphanRefresh = sourceReviewActionDescriptor("refresh-source-link", {
      item: { state: "orphan" },
    });
    const missingRelink = sourceReviewActionDescriptor("relink-source", {
      sourceBlockCount: 0,
    });
    const sourceNavigation = sourceReviewActionDescriptor("go-to-source");
    const refreshAll = sourceReviewActionDescriptor("refresh-all-safe-stale", {
      staleCount: 2,
    });

    assert.equal(staleRefresh.disabledReason, undefined);
    assert.equal(
      orphanRefresh.disabledReason,
      "Only stale source links can be refreshed safely.",
    );
    assert.equal(
      missingRelink.disabledReason,
      "No source blocks are available to relink.",
    );
    assert.equal(sourceNavigation.label, "Jump to source block");
    assert.equal(sourceNavigation.repairEligibility, "navigation-only");
    assert.equal(refreshAll.label, "Refresh all safe stale (2)");
    assert.equal(refreshAll.safety, "safe");
  });
});
