import {
  isDeckValidationCode,
  type DeckValidationCode,
} from "@/lib/presentation/validation";

export const SAFE_VALIDATION_CLASSIFICATIONS = [
  "schema_validation_failed",
  "unsupported_property",
  "invalid_version",
  "invalid_structure",
  "invalid_type",
  "invalid_limit",
  "invalid_value",
  "duplicate_id",
  "validation_internal_error",
] as const;

export type SafeValidationClassification =
  (typeof SAFE_VALIDATION_CLASSIFICATIONS)[number];

const CLASSIFICATION_BY_DIAGNOSTIC_CODE = {
  duplicate_id: "duplicate_id",
  invalid_limit: "invalid_limit",
  invalid_structure: "invalid_structure",
  invalid_type: "invalid_type",
  invalid_value: "invalid_value",
  invalid_version: "invalid_version",
  unsupported_property: "unsupported_property",
  validation_internal_error: "validation_internal_error",
} as const satisfies Record<DeckValidationCode, SafeValidationClassification>;

const CLASSIFICATION_PRIORITY: Readonly<
  Record<SafeValidationClassification, number>
> = {
  validation_internal_error: 90,
  invalid_version: 80,
  unsupported_property: 70,
  duplicate_id: 60,
  invalid_limit: 50,
  invalid_structure: 40,
  invalid_type: 30,
  invalid_value: 20,
  schema_validation_failed: 0,
};

export function classifyValidationDiagnostic(
  diagnostic: string,
): SafeValidationClassification {
  const separator = diagnostic.indexOf(":");
  const code = separator === -1 ? diagnostic : diagnostic.slice(0, separator);
  if (!isDeckValidationCode(code)) {
    return "schema_validation_failed";
  }
  return CLASSIFICATION_BY_DIAGNOSTIC_CODE[code];
}

export function classifyValidationDiagnostics(
  diagnostics: readonly string[],
): SafeValidationClassification {
  let classification: SafeValidationClassification = "schema_validation_failed";
  for (const diagnostic of diagnostics) {
    const candidate = classifyValidationDiagnostic(diagnostic);
    if (
      CLASSIFICATION_PRIORITY[candidate] >
      CLASSIFICATION_PRIORITY[classification]
    ) {
      classification = candidate;
    }
  }
  return classification;
}
