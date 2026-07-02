"use client";

/**
 * InlineTextEditorPresentation — contenteditable overlay for presentation text/shape nodes.
 *
 * Positioned absolutely over the node's layout frame (in canvas-percent
 * coordinates). Commits via `onCommit(paragraphs, frame?, textAlign?)`.
 *
 * Font resolution: uses basic CSS inherited from the slide canvas so the
 * visual experience is seamless during the enter/exit transition. A future
 * improvement can read ThemePackageV1 tokens for exact font matching.
 *
 * Handles the `textiq:inline-text-command-presentation` DOM event dispatched by the
 * context toolbar.
 */

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
} from "react";

import type { Paragraph } from "@/lib/presentation/schema";
import {
  INLINE_TEXT_COMMAND_EVENT_,
  type InlineTextCommandPayload,
} from "@/lib/presentation/inline-text-commands";
import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation/stage-chrome";

import { createInlineTextDomAdapter } from "./inline-text-dom-adapter";
import type {
  InlineTextAdapterExit,
  InlineTextAlign,
} from "./inline-text-dom-adapter";

export { inlineTextAlignForCommand } from "./inline-text-dom-adapter";
export type { InlineTextAlign } from "./inline-text-dom-adapter";

export type InlineTextInitialCaret =
  | { kind: "client"; x: number; y: number }
  | { kind: "start" };

export interface InlineTextEditorPresentationProps {
  /** Stable id of the node being edited. */
  nodeId: string;
  /** Initial paragraphs from `node.content.paragraphs`. */
  initialParagraphs: Paragraph[];
  /** Canvas-relative frame in percent units. */
  frame: { x: number; y: number; w: number; h: number };
  /** Canvas element bounding rect (reserved for future px-based font matching). */
  canvasRect?: DOMRect;
  /** Resolved canvas text CSS for the node being edited. */
  textStyle?: CSSProperties;
  /** When true, grow the editor and returned frame to fit edited text. */
  autoHeight?: boolean;
  /** Initial caret placement for click-to-edit. Defaults to the existing end position. */
  initialCaret?: InlineTextInitialCaret | null;
  /** Called when the user commits the edit (Escape, blur, or Tab). */
  onCommit: (
    nodeId: string,
    paragraphs: Paragraph[],
    nextFrame?: { x: number; y: number; w: number; h: number },
    textAlign?: InlineTextAlign,
  ) => void;
  /** Called when the user cancels (Escape with empty input). */
  onCancel: () => void;
  /**
   * Optional: move to the next text node in reading order (Tab key).
   * If omitted, Tab commits and no focus shift occurs.
   */
  onTabNext?: () => void;
  /**
   * Optional: move to the previous text node (Shift+Tab).
   */
  onTabPrev?: () => void;
}

// ---------------------------------------------------------------------------
// Caret placement helpers
// ---------------------------------------------------------------------------

function caretRangeFromPoint(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === "function") {
    return document.caretRangeFromPoint(x, y);
  }
  const docWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const position = docWithCaret.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function placeInitialCaret(
  container: HTMLElement,
  initialCaret: InlineTextInitialCaret | null | undefined,
): void {
  const selection = window.getSelection();
  if (!selection) return;

  if (initialCaret?.kind === "client") {
    const pointRange = caretRangeFromPoint(initialCaret.x, initialCaret.y);
    if (pointRange && container.contains(pointRange.startContainer)) {
      pointRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(pointRange);
      return;
    }
  }

  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(
    initialCaret?.kind === "start" || initialCaret?.kind === "client",
  );
  selection.removeAllRanges();
  selection.addRange(range);
}
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InlineTextEditorPresentation({
  nodeId,
  initialParagraphs,
  frame,
  canvasRect,
  textStyle,
  autoHeight = false,
  initialCaret,
  onCommit,
  onCancel,
  onTabNext,
  onTabPrev,
}: InlineTextEditorPresentationProps): JSX.Element {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const adapter = useMemo(
    () =>
      createInlineTextDomAdapter({
        nodeId,
        initialParagraphs,
      }),
    // Keep paragraph data as the entry snapshot so parent re-renders do not
    // reset in-progress DOM edits; a new node gets a fresh adapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeId],
  );

  // Position in viewport-px derived from canvas-percent frame
  const style: CSSProperties = {
    position: "absolute",
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${frame.w}%`,
    height: `${frame.h}%`,
    outline: "none",
    cursor: "text",
    // Keep text transparent so it layers exactly over the canvas render
    zIndex: STAGE_CHROME_Z_INDEX.inlineEditor,
    boxSizing: "border-box",
    padding: "inherit",
    // Match canvas font as best possible via inheritance
    font: "inherit",
    lineHeight: "inherit",
    color: "inherit",
    ...textStyle,
    wordBreak: "break-word",
    overflowWrap: "break-word",
  };

  function autoHeightFrame():
    | { x: number; y: number; w: number; h: number }
    | undefined {
    const el = editableRef.current;
    if (!autoHeight || !el || !canvasRect || canvasRect.height <= 0) {
      return undefined;
    }
    const heightPct = Math.min(
      100 - frame.y,
      Math.max(frame.h, (el.scrollHeight / canvasRect.height) * 100),
    );
    if (Math.abs(heightPct - frame.h) < 0.1) return undefined;
    return { ...frame, h: heightPct };
  }

  function syncAutoHeight() {
    const nextFrame = autoHeightFrame();
    if (nextFrame && editableRef.current) {
      editableRef.current.style.height = `${nextFrame.h}%`;
    }
  }

  // Focus and place caret when an inline edit session starts.
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    adapter.mountInitialHtml(el);
    el.focus();
    placeInitialCaret(el, initialCaret);
  }, [adapter, initialCaret]);

  function finishAdapterExit(exit: InlineTextAdapterExit) {
    if (exit.kind === "commit") {
      onCommit(nodeId, exit.paragraphs, autoHeightFrame(), exit.textAlign);
    } else if (exit.kind === "cancel") {
      onCancel();
    }
  }

  function doCommit() {
    finishAdapterExit(adapter.commit(editableRef.current));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      const exit = adapter.commitOrCancelForEscape(editableRef.current);
      if (exit.kind === "none") return;
      event.preventDefault();
      event.stopPropagation();
      finishAdapterExit(exit);
      return;
    }
    if (event.key === "Tab") {
      const exit = adapter.commitForTab(editableRef.current);
      if (exit.kind === "none") return;
      event.preventDefault();
      finishAdapterExit(exit);
      if (event.shiftKey) {
        onTabPrev?.();
      } else {
        onTabNext?.();
      }
      return;
    }
  }

  function handleCompositionStart() {
    adapter.startComposition();
  }

  function handleCompositionEnd() {
    finishAdapterExit(adapter.endComposition(editableRef.current));
  }

  // Listen for toolbar format commands
  useEffect(() => {
    function handleCommand(event: Event) {
      const payload = (event as CustomEvent<InlineTextCommandPayload>).detail;
      const el = editableRef.current;
      if (
        !el ||
        (!el.contains(document.activeElement) && document.activeElement !== el)
      )
        return;
      adapter.applyCommand(el, payload);
    }
    document.addEventListener(INLINE_TEXT_COMMAND_EVENT_, handleCommand);
    return () =>
      document.removeEventListener(INLINE_TEXT_COMMAND_EVENT_, handleCommand);
  }, [adapter]);

  return (
    <div
      ref={editableRef}
      contentEditable
      suppressContentEditableWarning
      data-inline-editor-presentation={nodeId}
      role="textbox"
      aria-label="Edit text"
      aria-multiline="true"
      style={style}
      onInput={syncAutoHeight}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBlur={doCommit}
    />
  );
}
