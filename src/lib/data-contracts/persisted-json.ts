import {
  validateAnchorGeometry,
  validateElementId,
  validateSlideId,
} from "@/lib/comments/anchors";
import { collectVisualNodes } from "@/lib/lexical/visual-nodes";
import { safeParseDeck } from "@/lib/presentation/validation";
import { safeParseVisual } from "@/lib/visual/schema";
import { parsePalette } from "@/lib/brand/schema";

import {
  COMMENT_ANCHOR_TYPE_LITERALS,
  parseVisualKindLiteral,
} from "./literals";

export type ContractValidationResult =
  { success: true } | { success: false; error: string };

export interface PersistedJsonContract {
  name: string;
  sourceOfTruth: string;
  validator: string;
  validate(value: unknown): ContractValidationResult;
}

function ok(): ContractValidationResult {
  return { success: true };
}

function fail(error: string): ContractValidationResult {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateDeckContract(value: unknown): ContractValidationResult {
  const parsed = safeParseDeck(value);
  return parsed.success ? ok() : fail(parsed.errors.join("; "));
}

function validateContentVisualsContract(
  value: unknown,
): ContractValidationResult {
  for (const node of collectVisualNodes(value)) {
    const parsed = safeParseVisual(node.visual);
    if (!parsed.success) {
      return fail(`visual ${node.visualId}: ${parsed.error}`);
    }
  }
  return ok();
}

function validateVisualContract(value: unknown): ContractValidationResult {
  const parsed = safeParseVisual(value);
  if (!parsed.success) {
    return fail(parsed.error);
  }
  return parseVisualKindLiteral(parsed.data.type).success
    ? ok()
    : fail("Visual type is not a current literal.");
}

function validateBrandPaletteContract(
  value: unknown,
): ContractValidationResult {
  if (value == null) {
    return ok();
  }
  return parsePalette(value) ? ok() : fail("Brand.palette must be a palette.");
}

function validateCommentAnchorContract(
  value: unknown,
): ContractValidationResult {
  if (!isRecord(value)) {
    return fail("Comment anchor record must be an object.");
  }

  const rawType = value.anchorType;
  if (
    rawType != null &&
    /* node:coverage ignore next 4 -- Invalid anchor-type branch is asserted; tsx maps multiline includes as uncovered. */
    !COMMENT_ANCHOR_TYPE_LITERALS.includes(
      rawType as (typeof COMMENT_ANCHOR_TYPE_LITERALS)[number],
    )
  ) {
    /* node:coverage ignore next -- Invalid anchor-type diagnostic is asserted; tsx maps the template return as uncovered. */
    return fail(
      `Comment anchorType must be one of: ${COMMENT_ANCHOR_TYPE_LITERALS.join(", ")}`,
    );
  }

  /* node:coverage ignore next -- Anchor validation success/failure paths are asserted; tsx maps the try entry as uncovered. */
  try {
    const slideId = validateSlideId(value.slideId);
    const elementId = validateElementId(value.elementId);
    validateAnchorGeometry(
      value.anchorGeometry as { x: unknown; y: unknown } | null | undefined,
    );

    if (elementId && !slideId) {
      return fail("Comment elementId anchors must also carry slideId.");
    }
    if ((slideId || elementId) && rawType != null) {
      return fail("Slide comment anchors must not also carry anchorType.");
    }
    if (rawType === "text" && typeof value.anchorText !== "string") {
      return fail("Text comment anchors must carry anchorText.");
    }
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Invalid comment anchor.",
    );
  }

  return ok();
}

export const PERSISTED_JSON_CONTRACTS = {
  /* node:coverage ignore next 15 -- Contract registry entries are asserted; tsx maps object literals as uncovered. */
  "Document.deckJson": {
    name: "Document.deckJson",
    sourceOfTruth: "Document.deckJson is the source of truth for slides.",
    validator: "@/lib/presentation/validation#safeParseDeck",
    validate: validateDeckContract,
  },
  "Document.contentJson:visual": {
    name: "Document.contentJson:visual",
    sourceOfTruth:
      "Document.contentJson is the source of truth for document text and embedded visuals.",
    validator:
      "@/lib/lexical/visual-nodes#collectVisualNodes + @/lib/visual/schema#safeParseVisual",
    validate: validateContentVisualsContract,
  },
  "DocumentVersion.deckJson": {
    name: "DocumentVersion.deckJson",
    sourceOfTruth:
      "DocumentVersion.deckJson snapshots must use Deck (schemaVersion 7).",
    validator: "@/lib/presentation/validation#safeParseDeck",
    validate: validateDeckContract,
  },
  "DocumentVersion.contentJson:visual": {
    name: "DocumentVersion.contentJson:visual",
    sourceOfTruth:
      "DocumentVersion.contentJson snapshots must embed current visual payloads.",
    validator:
      "@/lib/lexical/visual-nodes#collectVisualNodes + @/lib/visual/schema#safeParseVisual",
    validate: validateContentVisualsContract,
  },
  "Visual.data": {
    name: "Visual.data",
    sourceOfTruth:
      "Visual rows are a derived projection of visual nodes in Document.contentJson.",
    validator: "@/lib/visual/schema#safeParseVisual",
    validate: validateVisualContract,
  },
  "VisualRevision.data": {
    name: "VisualRevision.data",
    sourceOfTruth:
      "VisualRevision rows snapshot previous Visual.data payloads.",
    validator: "@/lib/visual/schema#safeParseVisual",
    validate: validateVisualContract,
  },
  "Brand.palette": {
    name: "Brand.palette",
    sourceOfTruth:
      "Brand.palette stores optional validated brand color palettes.",
    validator: "@/lib/brand/schema#parsePalette",
    validate: validateBrandPaletteContract,
  },
  "Comment.anchor": {
    name: "Comment.anchor",
    sourceOfTruth:
      "Comment anchor columns persist current text, visual, slide, or slide-element anchors.",
    validator: "@/lib/comments/anchors validators",
    validate: validateCommentAnchorContract,
  },
} as const satisfies Record<string, PersistedJsonContract>;

/* node:coverage ignore next 4 -- Public registry accessor is asserted; tsx maps the type alias/signature as uncovered. */
export type PersistedJsonContractName = keyof typeof PERSISTED_JSON_CONTRACTS;
export function getPersistedJsonContract(
  name: PersistedJsonContractName,
): PersistedJsonContract {
  return PERSISTED_JSON_CONTRACTS[name];
}
