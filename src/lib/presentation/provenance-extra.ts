import type { SlotKey, SourceRefreshState } from "./schema";
import type { JsonValue } from "./types";
import type {
  DocumentSlideMode,
  DocumentSlidePlanner,
} from "./document-slide-planner";

export const SOURCE_REVIEW_DISMISSAL_KEY = "sourceReviewDismissal";

export type DeckDerivationExtra = Record<string, JsonValue> & {
  pipelineVersion: 1;
  planner: DocumentSlidePlanner;
  mode: DocumentSlideMode;
  sourceDocumentId?: string;
  sourceContentHash: string;
  sourceBlockIds: string[];
  omittedBlockIds?: string[];
  generatedAt: string;
};

export type NodeDerivationExtra = Record<string, JsonValue> & {
  pipelineVersion: 1;
  slidePlanId: string;
  slotKey?: SlotKey;
  sourceBlockIds: string[];
};

export type SourceReviewDismissalExtra = Record<string, JsonValue> & {
  documentId?: string;
  blockId?: string;
  currentHash?: string;
  state?: SourceRefreshState;
  dismissedAt?: string;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlotKey(value: unknown): value is SlotKey {
  return (
    typeof value === "string" &&
    (
      [
        "kicker",
        "title",
        "subtitle",
        "body",
        "bullets",
        "leftTitle",
        "leftBody",
        "leftBullets",
        "rightTitle",
        "rightBody",
        "rightBullets",
        "cards",
        "steps",
        "quote",
        "attribution",
        "stat",
        "statLabel",
        "metrics",
        "table",
        "visualId",
        "imagePrompt",
        "caption",
      ] satisfies readonly SlotKey[]
    ).includes(value as SlotKey)
  );
}

export function buildDeckDerivationExtra({
  planner,
  mode,
  sourceDocumentId,
  sourceContentHash,
  sourceBlockIds,
  omittedBlockIds,
  generatedAt,
}: {
  planner: DocumentSlidePlanner;
  mode: DocumentSlideMode;
  sourceDocumentId?: string;
  sourceContentHash: string;
  sourceBlockIds: string[];
  omittedBlockIds?: string[];
  generatedAt: string;
}): DeckDerivationExtra {
  return {
    pipelineVersion: 1,
    planner,
    mode,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    sourceContentHash,
    sourceBlockIds,
    ...(omittedBlockIds && omittedBlockIds.length > 0
      ? { omittedBlockIds }
      : {}),
    generatedAt,
  };
}

export function readDeckDerivationExtra(
  value: unknown,
): DeckDerivationExtra | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.pipelineVersion !== 1 ||
    (value.planner !== "deterministic" && value.planner !== "ai") ||
    (value.mode !== "faithful" && value.mode !== "presentationRewrite") ||
    typeof value.sourceContentHash !== "string" ||
    !Array.isArray(value.sourceBlockIds) ||
    !value.sourceBlockIds.every((item) => typeof item === "string") ||
    typeof value.generatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    pipelineVersion: 1,
    planner: value.planner,
    mode: value.mode,
    ...(typeof value.sourceDocumentId === "string"
      ? { sourceDocumentId: value.sourceDocumentId }
      : {}),
    sourceContentHash: value.sourceContentHash,
    sourceBlockIds: value.sourceBlockIds,
    ...(Array.isArray(value.omittedBlockIds) &&
    value.omittedBlockIds.every((item) => typeof item === "string") &&
    value.omittedBlockIds.length > 0
      ? { omittedBlockIds: value.omittedBlockIds }
      : {}),
    generatedAt: value.generatedAt,
  };
}

export function buildNodeDerivationExtra({
  slidePlanId,
  slotKey,
  sourceBlockIds,
}: {
  slidePlanId: string;
  slotKey?: SlotKey;
  sourceBlockIds: string[];
}): NodeDerivationExtra {
  return {
    pipelineVersion: 1,
    slidePlanId,
    ...(slotKey ? { slotKey } : {}),
    sourceBlockIds,
  };
}

export function readNodeDerivationExtra(
  value: unknown,
): NodeDerivationExtra | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.pipelineVersion !== 1 ||
    typeof value.slidePlanId !== "string" ||
    !Array.isArray(value.sourceBlockIds) ||
    !value.sourceBlockIds.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return {
    pipelineVersion: 1,
    slidePlanId: value.slidePlanId,
    ...(isSlotKey(value.slotKey) ? { slotKey: value.slotKey } : {}),
    sourceBlockIds: value.sourceBlockIds,
  };
}

export function buildSourceReviewDismissalExtra({
  documentId,
  blockId,
  currentHash,
  state,
  dismissedAt,
  reason,
}: {
  documentId?: string;
  blockId?: string;
  currentHash?: string;
  state?: SourceRefreshState;
  dismissedAt?: string;
  reason?: string;
}): SourceReviewDismissalExtra {
  return {
    ...(documentId ? { documentId } : {}),
    ...(blockId ? { blockId } : {}),
    ...(currentHash ? { currentHash } : {}),
    ...(state ? { state } : {}),
    ...(dismissedAt ? { dismissedAt } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function readSourceReviewDismissalExtra(
  value: unknown,
): SourceReviewDismissalExtra | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.documentId === "string"
      ? { documentId: value.documentId }
      : {}),
    ...(typeof value.blockId === "string" ? { blockId: value.blockId } : {}),
    ...(typeof value.currentHash === "string"
      ? { currentHash: value.currentHash }
      : {}),
    ...(typeof value.state === "string"
      ? { state: value.state as SourceRefreshState }
      : {}),
    ...(typeof value.dismissedAt === "string"
      ? { dismissedAt: value.dismissedAt }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

export function readSourceReviewDismissalFromExtra(
  extra: Record<string, JsonValue> | undefined,
): SourceReviewDismissalExtra | undefined {
  return readSourceReviewDismissalExtra(extra?.[SOURCE_REVIEW_DISMISSAL_KEY]);
}

export function withSourceReviewDismissalExtra(
  extra: Record<string, JsonValue> | undefined,
  dismissal: SourceReviewDismissalExtra,
): Record<string, JsonValue> {
  return {
    ...(extra ?? {}),
    [SOURCE_REVIEW_DISMISSAL_KEY]: dismissal,
  };
}
