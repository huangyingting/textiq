import type { SourceRef } from "../deck-source-refs";
import { DeckValidationError, isPlainObject } from "./shared";

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function validateSourceRef(input: unknown, context: string): SourceRef {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (typeof input.documentId !== "string" || input.documentId.length === 0) {
    throw new DeckValidationError(
      `${context}.documentId must be a non-empty string`,
    );
  }
  if (typeof input.blockId !== "string" || input.blockId.length === 0) {
    throw new DeckValidationError(
      `${context}.blockId must be a non-empty string`,
    );
  }
  if (
    input.contentHash !== undefined &&
    (typeof input.contentHash !== "string" || input.contentHash.length === 0)
  ) {
    throw new DeckValidationError(
      `${context}.contentHash must be a non-empty string`,
    );
  }
  if (!isIsoTimestamp(input.linkedAt)) {
    throw new DeckValidationError(
      `${context}.linkedAt must be a valid ISO timestamp`,
    );
  }
  if (input.unlinked !== undefined && typeof input.unlinked !== "boolean") {
    throw new DeckValidationError(`${context}.unlinked must be a boolean`);
  }
  if (
    input.blockKind !== "text" &&
    input.blockKind !== "visual" &&
    input.blockKind !== "table"
  ) {
    throw new DeckValidationError(
      `${context}.blockKind must be "text", "visual", or "table"`,
    );
  }
  return {
    documentId: input.documentId,
    blockId: input.blockId,
    ...(typeof input.contentHash === "string"
      ? { contentHash: input.contentHash }
      : {}),
    linkedAt: input.linkedAt,
    ...(input.unlinked !== undefined ? { unlinked: input.unlinked } : {}),
    blockKind: input.blockKind,
  };
}
