import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DECK_JSON_MAX_BYTES,
  EXPORT_PREFLIGHT_MAX_SLIDES,
  GENERATED_DECK_MAX_SLIDES,
  IMPORT_MAX_BYTES_BY_MIME,
  IMPORT_MAX_UPLOAD_BYTES,
  INLINE_IMAGE_HARD_BYTES,
  LIMIT_INVENTORY,
  MAX_IMAGE_UPLOAD_BYTES as CENTRAL_MAX_IMAGE_UPLOAD_BYTES,
  SLIDE_ASSET_MAX_BYTES,
  SLIDE_ASSET_MAX_DIMENSION_PX,
  SLIDES_HARD_COUNT,
  TOTAL_IMAGE_BUDGET_BYTES,
} from "@/lib/limits";
import { MAX_DECK_SLIDES } from "@/lib/ai/deck-generation-options";
import { MAX_DECK_JSON_BYTES } from "@/lib/limits";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  TOTAL_IMAGE_BUDGET_BYTES as IMAGE_ELEMENT_BUDGET_BYTES,
} from "@/lib/visual/image-element";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_DIMENSION_PX,
} from "@/lib/slides/asset-upload";
import { MAX_UPLOAD_BYTES, maxBytesForMime } from "@/lib/import/validate";

describe("central limits boundary", () => {
  test("high-traffic validators import the same central hard caps", () => {
    assert.equal(MAX_DECK_JSON_BYTES, DECK_JSON_MAX_BYTES);
    assert.equal(MAX_DECK_SLIDES, GENERATED_DECK_MAX_SLIDES);

    assert.equal(MAX_UPLOAD_BYTES, IMPORT_MAX_UPLOAD_BYTES);
    assert.equal(
      maxBytesForMime("text/plain"),
      IMPORT_MAX_BYTES_BY_MIME["text/plain"],
    );
    assert.equal(
      maxBytesForMime("application/pdf"),
      IMPORT_MAX_BYTES_BY_MIME["application/pdf"],
    );

    assert.equal(ASSET_MAX_BYTES, SLIDE_ASSET_MAX_BYTES);
    assert.equal(ASSET_MAX_DIMENSION_PX, SLIDE_ASSET_MAX_DIMENSION_PX);

    assert.equal(EXPORT_PREFLIGHT_MAX_SLIDES, SLIDES_HARD_COUNT);
    assert.equal(IMAGE_ELEMENT_BUDGET_BYTES, TOTAL_IMAGE_BUDGET_BYTES);
    assert.equal(MAX_IMAGE_UPLOAD_BYTES, CENTRAL_MAX_IMAGE_UPLOAD_BYTES);
    assert.equal(TOTAL_IMAGE_BUDGET_BYTES, INLINE_IMAGE_HARD_BYTES);
  });

  test("inventory marks every entry as enforcement or warning-only", () => {
    assert.ok(LIMIT_INVENTORY.length >= 20);
    const ids = new Set<string>();
    for (const limit of LIMIT_INVENTORY) {
      assert.ok(limit.id);
      assert.ok(!ids.has(limit.id), `duplicate limit id ${limit.id}`);
      ids.add(limit.id);
      assert.ok(limit.value > 0);
      assert.ok(
        limit.enforcement === "enforced" || limit.enforcement === "warning",
      );
      assert.ok(limit.diagnostic.scope);
      assert.ok(limit.diagnostic.metric);
    }
  });
});
