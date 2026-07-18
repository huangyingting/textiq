import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DECK_ACTION_FAILURE_CODES,
  type DeckActionFailureCode,
  isDeckActionFailureCode,
  isDeckActionFailureError,
} from "./persistence-types";

const EXPECTED_DECK_ACTION_FAILURE_CODES = {
  document_not_found: true,
  invalid_deck: true,
  invalid_revision_token: true,
  deck_too_large: true,
  storage_unavailable: true,
} as const satisfies Record<DeckActionFailureCode, true>;

test("deck action failure guard accepts only the exhaustive public code union", () => {
  assert.deepEqual(
    DECK_ACTION_FAILURE_CODES,
    Object.keys(EXPECTED_DECK_ACTION_FAILURE_CODES),
  );

  for (const code of DECK_ACTION_FAILURE_CODES) {
    assert.equal(isDeckActionFailureCode(code), true, code);
    const error = Object.assign(new Error("safe public failure"), {
      failure: { code, retryable: code === "storage_unavailable" },
    });
    assert.equal(isDeckActionFailureError(error), true, code);
  }

  assert.equal(
    isDeckActionFailureError(
      Object.assign(new Error("provider detail"), {
        failure: { code: "prisma_timeout", retryable: true },
      }),
    ),
    false,
  );
  assert.equal(isDeckActionFailureCode("prisma_timeout"), false);
  assert.equal(isDeckActionFailureCode(null), false);
});
