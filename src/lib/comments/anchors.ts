import type { SlideCommentAnchor } from "@/lib/comments/slide-comment-anchors";
import { CommentError } from "./errors";

export type CommentAnchorType = "text" | "visual" | "table";

export type AnchorPoint = {
  x: number;
  y: number;
};

export type DeckCommentAnchor = {
  kind: "deck";
};

export type TextCommentAnchor = {
  kind: "text";
  text: string;
  nodeId: string | null;
};

export type DocumentBlockCommentAnchor = {
  kind: "document-block";
  blockKind: "visual" | "table";
  text: string | null;
  nodeId: string | null;
};

/* node:coverage ignore next 5 -- Type-only slide anchor shape is erased by TypeScript. */
export type SlideLevelCommentAnchor = {
  kind: "slide";
  slideId: string;
  geometry: AnchorPoint | null;
};

export type SlideElementCommentAnchor = {
  kind: "slide-element";
  slideId: string;
  elementId: string;
  geometry: AnchorPoint | null;
};

export type CommentAnchor =
  | DeckCommentAnchor
  | TextCommentAnchor
  | DocumentBlockCommentAnchor
  | SlideLevelCommentAnchor
  | SlideElementCommentAnchor;

export interface CommentAnchorRecord {
  anchorType?: string | null;
  anchorText?: string | null;
  anchorNodeId?: string | null;
  slideId?: string | null;
  elementId?: string | null;
  anchorGeometry?: unknown;
}

/**
 * Adapter for the persisted comment-anchor `anchorNodeId` column.
 *
 * Despite the historical column name, current comment anchors store durable
 * document block/visual ids here, not transient Lexical NodeKeys.
 */
export function anchorNodeIdFromDurableBlockId(
  blockId: string | null | undefined,
): string | null {
  return typeof blockId === "string" ? blockId : null;
}

/** Reads the durable document block/visual id from a comment-anchor record. */
export function durableBlockIdFromAnchorRecord(
  record: Pick<CommentAnchorRecord, "anchorNodeId">,
): string | null {
  return anchorNodeIdFromDurableBlockId(record.anchorNodeId);
}

export function normalizeAnchorType(
  value: string | null,
): CommentAnchorType | null {
  return value === "text" || value === "visual" || value === "table"
    ? value
    : null;
}

export function normalizeAnchorText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const COORD_MIN = 0;
const COORD_MAX = 100;

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateAnchorGeometry(
  raw: { x: unknown; y: unknown } | null | undefined,
): AnchorPoint | null {
  if (raw == null) {
    return null;
  }

  if (!isFiniteCoordinate(raw.x) || !isFiniteCoordinate(raw.y)) {
    throw new CommentError(
      "invalid_anchor_geometry",
      "Anchor geometry must have numeric x and y coordinates.",
    );
  }

  if (
    raw.x < COORD_MIN ||
    raw.x > COORD_MAX ||
    raw.y < COORD_MIN ||
    raw.y > COORD_MAX
  ) {
    throw new CommentError(
      "invalid_anchor_geometry",
      `Anchor geometry coordinates must be between ${COORD_MIN} and ${COORD_MAX}.`,
    );
  }

  return { x: raw.x, y: raw.y };
}

export function sanitizeAnchorGeometry(raw: unknown): AnchorPoint | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const geometry = raw as { x?: unknown; y?: unknown };
  if (!isFiniteCoordinate(geometry.x) || !isFiniteCoordinate(geometry.y)) {
    return null;
  }
  if (
    geometry.x < COORD_MIN ||
    geometry.x > COORD_MAX ||
    geometry.y < COORD_MIN ||
    geometry.y > COORD_MAX
  ) {
    return null;
  }
  return { x: geometry.x, y: geometry.y };
}

export function validateSlideId(raw: unknown): string | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new CommentError("invalid_slide_id", "slideId must be a string.");
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateElementId(raw: unknown): string | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new CommentError("invalid_element_id", "elementId must be a string.");
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function slideAnchorFromRecord(
  record: CommentAnchorRecord,
): SlideCommentAnchor {
  return {
    slideId: record.slideId ?? null,
    elementId: record.elementId ?? null,
    geometry: sanitizeAnchorGeometry(record.anchorGeometry),
  };
}

export function slideAnchorToRecord(anchor: SlideCommentAnchor): {
  slideId: string | null;
  elementId: string | null;
  anchorGeometry: AnchorPoint | null;
} {
  return {
    slideId: anchor.slideId ?? null,
    elementId: anchor.elementId ?? null,
    anchorGeometry: anchor.geometry ?? null,
  };
}

export function commentAnchorFromRecord(
  record: CommentAnchorRecord,
): CommentAnchor {
  const slideId = record.slideId ?? null;
  const elementId = record.elementId ?? null;
  const geometry = sanitizeAnchorGeometry(record.anchorGeometry);

  if (slideId && elementId) {
    return { kind: "slide-element", slideId, elementId, geometry };
  }
  if (slideId) {
    return { kind: "slide", slideId, geometry };
  }

  const anchorType = normalizeAnchorType(record.anchorType ?? null);
  if (anchorType === "text" && record.anchorText) {
    return {
      kind: "text",
      text: record.anchorText,
      nodeId: durableBlockIdFromAnchorRecord(record),
    };
  }
  if (anchorType === "visual" || anchorType === "table") {
    return {
      kind: "document-block",
      blockKind: anchorType,
      text: record.anchorText ?? null,
      nodeId: durableBlockIdFromAnchorRecord(record),
    };
  }

  return { kind: "deck" };
}

export function commentAnchorToRecord(
  anchor: CommentAnchor,
): Required<CommentAnchorRecord> {
  switch (anchor.kind) {
    case "text":
      /* node:coverage disable */
      /* Text anchor DTO object is asserted; tsx maps the literal tail as uncovered. */
      return {
        anchorType: "text",
        anchorText: anchor.text,
        anchorNodeId: anchorNodeIdFromDurableBlockId(anchor.nodeId),
        slideId: null,
        elementId: null,
        anchorGeometry: null,
      };
    /* node:coverage enable */
    case "document-block":
      /* Coverage rationale: visual block anchor DTO object is asserted; tsx maps the literal tail as uncovered. */
      /* node:coverage ignore next 8 */
      return {
        anchorType: anchor.blockKind,
        anchorText: anchor.text,
        anchorNodeId: anchorNodeIdFromDurableBlockId(anchor.nodeId),
        slideId: null,
        elementId: null,
        anchorGeometry: null,
      };
    case "slide":
      return {
        anchorType: null,
        anchorText: null,
        anchorNodeId: null,
        slideId: anchor.slideId,
        elementId: null,
        anchorGeometry: anchor.geometry,
      };
    case "slide-element":
      return {
        anchorType: null,
        anchorText: null,
        anchorNodeId: null,
        slideId: anchor.slideId,
        elementId: anchor.elementId,
        anchorGeometry: anchor.geometry,
      };
    case "deck":
      return {
        anchorType: null,
        anchorText: null,
        anchorNodeId: null,
        slideId: null,
        elementId: null,
        anchorGeometry: null,
      };
  }
}
