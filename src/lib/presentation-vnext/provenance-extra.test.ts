import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SOURCE_REVIEW_DISMISSAL_KEY,
  buildDeckDerivationExtra,
  buildNodeDerivationExtra,
  buildSourceReviewDismissalExtra,
  readDeckDerivationExtra,
  readNodeDerivationExtra,
  readSourceReviewDismissalExtra,
  readSourceReviewDismissalFromExtra,
  withSourceReviewDismissalExtra,
} from "./provenance-extra";

const stringify = (value: unknown) => JSON.stringify(value);

describe("provenance extra helpers", () => {
  test("builds deck derivation with identical serialized key order", () => {
    const actual = buildDeckDerivationExtra({
      planner: "ai",
      mode: "presentationRewrite",
      sourceDocumentId: "doc-1",
      sourceContentHash: "hash-doc",
      sourceBlockIds: ["block-1", "block-2"],
      omittedBlockIds: ["block-3"],
      generatedAt: "2026-07-02T00:00:00.000Z",
    });
    const expected = {
      pipelineVersion: 1,
      planner: "ai",
      mode: "presentationRewrite",
      sourceDocumentId: "doc-1",
      sourceContentHash: "hash-doc",
      sourceBlockIds: ["block-1", "block-2"],
      omittedBlockIds: ["block-3"],
      generatedAt: "2026-07-02T00:00:00.000Z",
    };

    assert.equal(stringify(actual), stringify(expected));
    assert.equal(
      stringify(readDeckDerivationExtra(actual)),
      stringify(expected),
    );
  });

  test("omits absent deck derivation optional fields", () => {
    const actual = buildDeckDerivationExtra({
      planner: "deterministic",
      mode: "faithful",
      sourceContentHash: "hash-doc",
      sourceBlockIds: ["block-1"],
      omittedBlockIds: [],
      generatedAt: "2026-07-02T00:00:00.000Z",
    });
    const expected = {
      pipelineVersion: 1,
      planner: "deterministic",
      mode: "faithful",
      sourceContentHash: "hash-doc",
      sourceBlockIds: ["block-1"],
      generatedAt: "2026-07-02T00:00:00.000Z",
    };

    assert.equal(stringify(actual), stringify(expected));
  });

  test("builds node derivation with identical serialized key order", () => {
    const actual = buildNodeDerivationExtra({
      slidePlanId: "plan-slide-1",
      slotKey: "body",
      sourceBlockIds: ["block-1", "block-2"],
    });
    const expected = {
      pipelineVersion: 1,
      slidePlanId: "plan-slide-1",
      slotKey: "body",
      sourceBlockIds: ["block-1", "block-2"],
    };

    assert.equal(stringify(actual), stringify(expected));
    assert.equal(
      stringify(readNodeDerivationExtra(actual)),
      stringify(expected),
    );
  });

  test("omits absent node derivation optional fields", () => {
    const actual = buildNodeDerivationExtra({
      slidePlanId: "plan-slide-1",
      sourceBlockIds: ["block-1"],
    });
    const expected = {
      pipelineVersion: 1,
      slidePlanId: "plan-slide-1",
      sourceBlockIds: ["block-1"],
    };

    assert.equal(stringify(actual), stringify(expected));
  });

  test("builds source-review dismissal with identical serialized key order", () => {
    const actual = buildSourceReviewDismissalExtra({
      documentId: "doc-1",
      blockId: "block-1",
      currentHash: "hash-current",
      state: "stale",
      dismissedAt: "2026-07-02T00:00:00.000Z",
      reason: "Source content changed.",
    });
    const expected = {
      documentId: "doc-1",
      blockId: "block-1",
      currentHash: "hash-current",
      state: "stale",
      dismissedAt: "2026-07-02T00:00:00.000Z",
      reason: "Source content changed.",
    };

    assert.equal(stringify(actual), stringify(expected));
    assert.equal(
      stringify(readSourceReviewDismissalExtra(actual)),
      stringify(expected),
    );
  });

  test("merges source-review dismissal without changing existing extra order", () => {
    const dismissal = buildSourceReviewDismissalExtra({
      state: "unknown",
      dismissedAt: "2026-07-02T00:00:00.000Z",
      reason: "Source review item dismissed.",
    });
    const actual = withSourceReviewDismissalExtra(
      { reviewed: true, note: "keep" },
      dismissal,
    );
    const expected = {
      reviewed: true,
      note: "keep",
      [SOURCE_REVIEW_DISMISSAL_KEY]: {
        state: "unknown",
        dismissedAt: "2026-07-02T00:00:00.000Z",
        reason: "Source review item dismissed.",
      },
    };

    assert.equal(stringify(actual), stringify(expected));
    assert.equal(
      stringify(readSourceReviewDismissalFromExtra(actual)),
      stringify(expected[SOURCE_REVIEW_DISMISSAL_KEY]),
    );
  });

  test("readers reject malformed derivation containers", () => {
    assert.equal(readDeckDerivationExtra(null), undefined);
    assert.equal(
      readDeckDerivationExtra({
        pipelineVersion: 1,
        planner: "ai",
        mode: "faithful",
        sourceContentHash: "hash-doc",
        sourceBlockIds: [1],
        generatedAt: "2026-07-02T00:00:00.000Z",
      }),
      undefined,
    );
    assert.equal(readNodeDerivationExtra([]), undefined);
    assert.equal(
      readSourceReviewDismissalFromExtra({ sourceReviewDismissal: [] }),
      undefined,
    );
  });
});
