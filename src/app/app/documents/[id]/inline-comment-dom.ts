import {
  DOCUMENT_GUTTER_BUTTON_SIZE,
  DOCUMENT_GUTTER_GAP,
  rightGutterButtonLeft,
} from "./document-gutter";

const MAX_ANCHOR_TEXT_LENGTH = 280;
const COMMENT_CARD_WIDTH = 240;
export const COMMENT_CARD_VIEWPORT_BLOCK_GAP = 10;
const COMMENT_CARD_VIEWPORT_INLINE_GAP = 36;

export type AnchorPosition = {
  text: string;
  nodeId: string | null;
  top: number;
  iconLeft: number;
  markerLeft: number;
};

export type CommentCardPosition = {
  anchorText: string;
  top: number;
  left: number;
  maxHeight: number;
};

export function normalizeInlineAnchorText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ANCHOR_TEXT_LENGTH);
}

function durableBlockIdForElement(element: HTMLElement): string | null {
  return element.getAttribute("data-lexical-block-id") || null;
}

export function isVisualCommentBlock(element: HTMLElement): boolean {
  return (
    element.closest("[data-visual-chrome],[data-lexical-visual-id]") !== null ||
    element.querySelector("[data-visual-chrome],[data-lexical-visual-id]") !==
      null
  );
}

export function isTextCommentBlock(element: HTMLElement): boolean {
  if (isVisualCommentBlock(element)) {
    return false;
  }
  return normalizeInlineAnchorText(element.textContent ?? "").length > 0;
}
export function commentBlockAtY(
  root: HTMLElement,
  clientY: number,
): HTMLElement | null {
  const blocks = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  let nearest: { block: HTMLElement; distance: number } | null = null;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return isTextCommentBlock(block) ? block : null;
    }
    if (!isTextCommentBlock(block)) {
      continue;
    }
    const distance = Math.min(
      Math.abs(clientY - rect.top),
      Math.abs(clientY - rect.bottom),
    );
    if (!nearest || distance < nearest.distance) {
      nearest = { block, distance };
    }
  }
  return nearest && nearest.distance <= 32 ? nearest.block : null;
}

export function isInRightCommentGutter(
  root: HTMLElement,
  clientX: number,
): boolean {
  const rootRect = root.getBoundingClientRect();
  const buttonLeft = rightGutterButtonLeft(rootRect);
  if (buttonLeft === null || buttonLeft < rootRect.right) {
    return false;
  }
  return (
    clientX >= rootRect.right &&
    clientX <= buttonLeft + DOCUMENT_GUTTER_BUTTON_SIZE + DOCUMENT_GUTTER_GAP
  );
}

export function anchorPositionForBlock(
  block: HTMLElement,
  root: HTMLElement,
): AnchorPosition | null {
  const text = normalizeInlineAnchorText(block.textContent ?? "");
  if (!text) return null;
  const blockRect = block.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const iconLeft = rightGutterButtonLeft(rootRect);
  if (iconLeft === null) {
    return null;
  }
  return {
    text,
    nodeId: durableBlockIdForElement(block),
    top: blockRect.top + blockRect.height / 2,
    iconLeft,
    markerLeft: iconLeft,
  };
}

export function preferredRightSideCardLeft(anchor: AnchorPosition): number {
  return anchor.iconLeft + DOCUMENT_GUTTER_BUTTON_SIZE + DOCUMENT_GUTTER_GAP;
}

export function computeCommentCardPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  measuredWidth,
  measuredHeight,
}: {
  anchor: AnchorPosition;
  viewportWidth: number;
  viewportHeight: number;
  measuredWidth: number;
  measuredHeight: number;
}): CommentCardPosition {
  const maxHeight = Math.max(
    180,
    viewportHeight - COMMENT_CARD_VIEWPORT_BLOCK_GAP * 2,
  );
  const maxWidth = Math.max(
    180,
    viewportWidth - COMMENT_CARD_VIEWPORT_INLINE_GAP * 2,
  );
  const cardWidth =
    measuredWidth > 0 ? Math.min(measuredWidth, maxWidth) : COMMENT_CARD_WIDTH;
  const cardHeight =
    measuredHeight > 0 ? Math.min(measuredHeight, maxHeight) : 240;
  const preferredTop = anchor.top - COMMENT_CARD_VIEWPORT_BLOCK_GAP;
  const preferredLeft = preferredRightSideCardLeft(anchor);
  const maxLeft = Math.max(
    COMMENT_CARD_VIEWPORT_INLINE_GAP,
    viewportWidth - cardWidth - COMMENT_CARD_VIEWPORT_INLINE_GAP,
  );
  const left = Math.min(
    Math.max(preferredLeft, COMMENT_CARD_VIEWPORT_INLINE_GAP),
    maxLeft,
  );
  const maxTop = Math.max(
    COMMENT_CARD_VIEWPORT_BLOCK_GAP,
    viewportHeight - cardHeight - COMMENT_CARD_VIEWPORT_BLOCK_GAP,
  );
  const top = Math.min(
    Math.max(preferredTop, COMMENT_CARD_VIEWPORT_BLOCK_GAP),
    maxTop,
  );

  return {
    anchorText: anchor.text,
    top,
    left,
    maxHeight,
  };
}
