import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  classifyValidationDiagnostic,
  classifyValidationDiagnostics,
  SAFE_VALIDATION_CLASSIFICATIONS,
  type SafeValidationClassification,
} from "./validation-classification";
import {
  DECK_VALIDATION_CODES,
  isDeckValidationCode,
  type DeckValidationCode,
} from "@/lib/presentation/validation";

const EXPECTED_CLASSIFICATION_BY_VALIDATOR_CODE = {
  duplicate_id: "duplicate_id",
  invalid_limit: "invalid_limit",
  invalid_structure: "invalid_structure",
  invalid_type: "invalid_type",
  invalid_value: "invalid_value",
  invalid_version: "invalid_version",
  unsupported_property: "unsupported_property",
  validation_internal_error: "validation_internal_error",
} as const satisfies Record<DeckValidationCode, SafeValidationClassification>;

describe("validation diagnostic classification", () => {
  test("maps every exported validator code to its exact safe classification", () => {
    assert.equal(DECK_VALIDATION_CODES.length, 8);
    for (const code of DECK_VALIDATION_CODES) {
      assert.match(code, /^[a-z_]+$/);
      assert.equal(
        classifyValidationDiagnostic(`${code}: private.path: private reason`),
        EXPECTED_CLASSIFICATION_BY_VALIDATOR_CODE[code],
      );
    }
  });

  test("keeps output fallback separate from validator input codes", () => {
    for (const value of [
      "schema_validation_failed",
      "unsupported_type",
      "private_unknown_key",
      "invalid_value_extra",
      "invalid_value.private",
    ]) {
      assert.equal(isDeckValidationCode(value), false);
      assert.equal(
        classifyValidationDiagnostic(
          `${value}: user@example.com: https://private.example`,
        ),
        "schema_validation_failed",
      );
    }
    assert.equal(classifyValidationDiagnostics([]), "schema_validation_failed");
    assert.equal(SAFE_VALIDATION_CLASSIFICATIONS.length, 9);
  });

  test("selects the highest-value safe classification without exposing details", () => {
    assert.equal(
      classifyValidationDiagnostics([
        "invalid_value: Deck.title: PRIVATE PARAGRAPH",
        "unsupported_property: Deck: unsupported property count=1",
        "invalid_structure: Deck.slides: must be an array",
      ]),
      "unsupported_property",
    );
  });
});
