"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import type {
  Paragraph,
  SlideElement,
  TextElementStyle,
} from "@/lib/presentation/deck";
import type { ElementPatch } from "@/lib/presentation/deck-mutations";
import type { ResolvedTextStyle } from "@/lib/presentation/style-cascade-text";
import {
  mergeRuns,
  runsToHtml,
  serializeRichText,
  shouldStoreRuns,
  splitRunsIntoLines,
} from "@/lib/presentation/rich-text-html";
import {
  applyBoldOrItalic,
  insertTextAtCursor,
} from "@/lib/presentation/rich-text-commands";
import {
  AUTO_FIT_PADDING_PCT,
  clampBox,
} from "@/lib/presentation/stage-resize";
import {
  isAutoHeight,
  type TextLikeElement,
} from "@/lib/presentation/text-element-fit";
import { SLIDE_TEXT_FONT_SIZE } from "@/lib/presentation/text-defaults";
import { useSlideFontsReady } from "@/lib/presentation-shared/slide-font-loading";
import { resolveElementFontCss } from "@/lib/presentation-shared/slide-fonts";
import {
  elementDesignOverrides,
  shapeContent,
  shapeTextDesign,
  textContent,
  textDesign,
} from "@/components/presentation/slide-canvas/v6-model";

export const INLINE_TEXT_COMMAND_EVENT = "textiq:inline-text-command";

export type InlineTextCommandPayload =
  | { command: "bold" | "italic" | "underline" }
  | { command: "color"; value: string }
  | { command: "fontSize"; value: number }
  | { command: "align"; value: "left" | "center" | "right" }
  | { command: "list"; value: "bullet" | "number" | undefined }
  | { command: "indent"; delta: -1 | 1 };

export type InlineTextCommandDetail = InlineTextCommandPayload & {
  elementId: string;
};

function defaultShapeTextStyle(): TextElementStyle {
  return {
    fontSize: SLIDE_TEXT_FONT_SIZE.text,
    bold: false,
    italic: false,
    align: "center" as const,
  };
}

type InlineListMeta = { indent: number; listType: "bullet" | "number" };

function bulletMarker(indent: number): string {
  if (indent === 0) return "";
  if (indent === 1) return "◦";
  return "–";
}

function listNumbers(meta: readonly InlineListMeta[]): (number | null)[] {
  const counters = new Array(6).fill(0) as number[];
  return meta.map((entry) => {
    const indent = Math.max(0, Math.min(5, entry.indent));
    if (entry.listType !== "number") {
      for (let depth = indent; depth < counters.length; depth++) {
        counters[depth] = 0;
      }
      return null;
    }
    for (let depth = indent + 1; depth < counters.length; depth++) {
      counters[depth] = 0;
    }
    counters[indent]++;
    return counters[indent];
  });
}

function syncInlineListMarkers(
  node: HTMLElement,
  meta: InlineListMeta[],
): InlineListMeta[] {
  const lines = Array.from(node.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const next = lines.map((line, index) => {
    const entry = meta[index] ??
      meta[index - 1] ?? {
        indent: 0,
        listType: "bullet" as const,
      };
    const normalized = {
      indent: Math.max(0, Math.min(5, entry.indent ?? 0)),
      listType: entry.listType ?? "bullet",
    };
    const marker = bulletMarker(normalized.indent);
    line.dataset.listType = normalized.listType;
    if (marker) {
      line.dataset.listMarker = marker;
    } else {
      delete line.dataset.listMarker;
    }
    line.style.marginLeft =
      normalized.indent > 0 ? `${normalized.indent * 1.5}em` : "";
    return normalized;
  });
  const numbers = listNumbers(next);
  lines.forEach((line, index) => {
    const number = numbers[index];
    if (number !== null) {
      line.dataset.listNumber = String(number);
    } else {
      delete line.dataset.listNumber;
    }
  });
  return next;
}

function useInlineShrinkScale(
  contentRef: RefObject<HTMLElement | null>,
  boundsRef: RefObject<HTMLElement | null>,
  baseFontSize: number,
  fitMode: string | undefined,
): number {
  const enabled = fitMode === "shrink-to-fit";
  const fontsReady = useSlideFontsReady();
  const configKey = `${baseFontSize}:${fitMode ?? ""}:${fontsReady ? 1 : 0}`;
  const [sizing, setSizing] = useState({ key: configKey, scale: 1 });
  const scale = sizing.key === configKey ? sizing.scale : 1;

  if (sizing.key !== configKey) {
    setSizing({ key: configKey, scale: 1 });
  }

  useLayoutEffect(() => {
    if (!enabled) return;
    const contentNode = contentRef.current;
    const boundsNode = boundsRef.current;
    if (!contentNode || !boundsNode) return;
    const overflows =
      contentNode.scrollHeight > boundsNode.clientHeight + 1 ||
      contentNode.scrollWidth > boundsNode.clientWidth + 1;
    if (!overflows || scale <= 0.55) return;
    const nextScale = Math.max(0.55, scale * 0.88);
    setSizing((current) =>
      current.key === configKey && Math.abs(current.scale - nextScale) > 0.001
        ? { ...current, scale: nextScale }
        : current,
    );
  }, [boundsRef, configKey, contentRef, enabled, scale]);

  return enabled ? scale : 1;
}

// ---------------------------------------------------------------------------
// Inline text editor — a transparent `contentEditable` overlay that renders the
// element's rich-text runs in place, so entering edit mode is WYSIWYG (no style
// jump) and per-run bold / italic / color / link formatting is preserved on
// every keystroke instead of being flattened to plain text.
// ---------------------------------------------------------------------------

/**
 * Cross-browser caret range from a viewport point. Chrome / Safari expose
 * `caretRangeFromPoint`; Firefox uses the standard `caretPositionFromPoint`.
 * Returns `null` when neither is available or the point hits nothing.
 */
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
  const pos = docWithCaret.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

export function InlineTextEditor({
  element,
  color,
  resolvedTextStyle,
  accent,
  stageHeight,
  caretClient,
  onChange,
  onCommit,
}: {
  element: Extract<SlideElement, { kind: "text" | "shape" }>;
  color: string;
  resolvedTextStyle?: ResolvedTextStyle;
  accent: string;
  stageHeight: number;
  caretClient: { x: number; y: number } | null;
  onChange: (patch: ElementPatch) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<HTMLDivElement>(null);
  // Snapshot the element kind once so the live keystroke handler never depends
  // on the (changing) element prop — the DOM is the source of truth while the
  // overlay is mounted and its innerHTML is set exactly once below.
  const kind = element.kind;
  const initialTextContent = kind === "text" ? textContent(element) : null;
  const isListText =
    element.kind === "text" &&
    (initialTextContent?.paragraphs ?? []).some(
      (paragraph) => paragraph.listType !== undefined,
    );
  // Snapshot the open-caret point once (mount only) so later renders never move
  // the caret while the user types.
  const caretRef = useRef(caretClient);

  // Per-item indent / listType metadata for bullets (#335).
  // Seeded from the element on mount, updated via Tab/Shift+Tab.
  const itemMetaRef = useRef<InlineListMeta[]>([]);
  const dirtyRef = useRef(false);

  const currentLineIndex = useCallback(() => {
    const node = ref.current;
    const sel = window.getSelection();
    if (!node || !sel || sel.rangeCount === 0) return -1;
    let cursor: Node | null = sel.getRangeAt(0).startContainer;
    while (cursor && cursor.parentNode !== node) {
      cursor = cursor.parentNode;
    }
    if (!cursor) return -1;
    return Array.from(node.children).indexOf(cursor as Element);
  }, []);

  const applySelectionSpanStyle = useCallback(
    (style: Partial<CSSStyleDeclaration>) => {
      const node = ref.current;
      const selection = window.getSelection();
      if (!node || !selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      if (range.collapsed || !node.contains(range.commonAncestorContainer)) {
        return false;
      }
      const span = document.createElement("span");
      Object.assign(span.style, style);
      span.append(range.extractContents());
      range.insertNode(span);
      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(span);
      selection.addRange(nextRange);
      return true;
    },
    [],
  );

  const emitChange = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Auto-height mode: grow the box to fit the live content so a multi-line
    // edit expands the frame instead of clipping. Fixed-box and shrink-to-fit
    // keep the stored height; content is clipped or scaled by the renderer
    // (#333). Shapes never auto-grow (they have no fitMode).
    const autoH =
      kind !== "shape" &&
      isAutoHeight({
        ...(element as TextLikeElement),
        content: {
          ...(element as Extract<SlideElement, { kind: "text" }>).content,
          fitMode: textContent(
            element as Extract<SlideElement, { kind: "text" }>,
          ).fitMode,
        },
      });
    const box = autoH
      ? clampBox({
          ...element.box,
          h: Math.max(
            element.box.h,
            (node.scrollHeight / stageHeight) * 100 + AUTO_FIT_PADDING_PCT * 2,
          ),
        })
      : element.box;
    if (isListText) {
      itemMetaRef.current = syncInlineListMarkers(node, itemMetaRef.current);
    }
    const { text, runs } = serializeRichText(node);
    if (kind === "text") {
      if (isListText) {
        const lines = splitRunsIntoLines(runs)
          .map((line) => ({
            text: line.text.replace(/\s+$/, ""),
            runs: mergeRuns(line.runs),
          }))
          .filter((line) => line.text.length > 0);
        const meta = itemMetaRef.current;
        const paragraphs: Paragraph[] = lines.map((line, i) => ({
          text: line.text,
          ...(shouldStoreRuns(line.runs) ? { runs: line.runs } : {}),
          indent: meta[i]?.indent ?? 0,
          listType: meta[i]?.listType ?? "bullet",
        }));
        const current = textContent(
          element as Extract<SlideElement, { kind: "text" }>,
        );
        onChange({
          content: {
            ...current,
            kind: "text",
            text: lines.map((line) => line.text).join("\n"),
            runs: undefined,
            paragraphs,
          },
          ...(autoH ? { box } : {}),
        } as ElementPatch);
        return;
      }
      const current = textContent(
        element as Extract<SlideElement, { kind: "text" }>,
      );
      onChange({
        content: {
          ...current,
          kind: "text",
          text,
          runs: shouldStoreRuns(runs) ? runs : undefined,
          paragraphs: [
            {
              text,
              ...(shouldStoreRuns(runs) ? { runs } : {}),
            },
          ],
        },
        ...(autoH ? { box } : {}),
      } as ElementPatch);
      return;
    }
    if (kind === "shape") {
      const trimmed = text.trim();
      const current = shapeContent(
        element as Extract<SlideElement, { kind: "shape" }>,
      );
      onChange({
        content: {
          ...current,
          kind: "shape",
          text: trimmed.length > 0 ? text : undefined,
          textRuns:
            trimmed.length > 0 && shouldStoreRuns(runs) ? runs : undefined,
        },
        designOverrides: {
          ...elementDesignOverrides(element),
          textStyle: {
            ...defaultShapeTextStyle(),
            ...shapeTextDesign(
              element as Extract<SlideElement, { kind: "shape" }>,
            ),
          },
        },
      } as ElementPatch);
      return;
    }
  }, [kind, isListText, onChange, stageHeight, element]);

  const commit = useCallback(() => {
    if (dirtyRef.current) {
      emitChange();
    }
    onCommit();
  }, [emitChange, onCommit]);

  useEffect(() => {
    function onInlineTextCommand(event: Event) {
      const detail = (event as CustomEvent<InlineTextCommandDetail>).detail;
      if (!detail || detail.elementId !== element.id) return;
      const node = ref.current;
      if (!node) return;
      const selection = window.getSelection();
      if (
        !selection ||
        selection.rangeCount === 0 ||
        !selection.anchorNode ||
        !node.contains(selection.anchorNode)
      ) {
        node.focus();
      }

      if (detail.command === "bold") document.execCommand("bold");
      else if (detail.command === "italic") document.execCommand("italic");
      else if (detail.command === "underline") {
        document.execCommand("underline");
      } else if (detail.command === "color") {
        document.execCommand("foreColor", false, detail.value);
      } else if (detail.command === "fontSize") {
        applySelectionSpanStyle({ fontSize: `${detail.value}cqh` });
      } else if (detail.command === "align") {
        const command =
          detail.value === "center"
            ? "justifyCenter"
            : detail.value === "right"
              ? "justifyRight"
              : "justifyLeft";
        document.execCommand(command);
      } else if (isListText && detail.command === "list") {
        const lineIdx = currentLineIndex();
        if (lineIdx >= 0) {
          const meta = itemMetaRef.current;
          const current = meta[lineIdx] ?? { indent: 0, listType: "bullet" };
          meta[lineIdx] = {
            ...current,
            listType: detail.value ?? current.listType,
          };
        }
      } else if (isListText && detail.command === "indent") {
        const lineIdx = currentLineIndex();
        if (lineIdx >= 0) {
          const meta = itemMetaRef.current;
          const current = meta[lineIdx] ?? { indent: 0, listType: "bullet" };
          meta[lineIdx] = {
            ...current,
            indent: Math.max(0, Math.min(5, current.indent + detail.delta)),
          };
        }
      }
      dirtyRef.current = true;
      emitChange();
    }

    window.addEventListener(INLINE_TEXT_COMMAND_EVENT, onInlineTextCommand);
    return () =>
      window.removeEventListener(
        INLINE_TEXT_COMMAND_EVENT,
        onInlineTextCommand,
      );
  }, [
    applySelectionSpanStyle,
    currentLineIndex,
    element.id,
    emitChange,
    isListText,
  ]);

  // Seed the editable surface with the rendered runs, then place the caret: at
  // the click point for a single-click open, otherwise select all (double-click
  // / keyboard). Bullets are seeded as one `<div>` per line so each is a block
  // the marker CSS can attach to and so Enter creates a new bullet. Runs only on
  // mount; deck updates flow out (never back into the DOM) so the caret is never
  // disturbed mid-edit.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (kind === "text" && !isListText) {
      const content = textContent(
        element as Extract<SlideElement, { kind: "text" }>,
      );
      node.innerHTML = runsToHtml(content.runs, content.text);
    } else if (kind === "shape") {
      const content = shapeContent(
        element as Extract<SlideElement, { kind: "shape" }>,
      );
      node.innerHTML = runsToHtml(content.textRuns, content.text ?? "");
    } else {
      // Seed indent metadata from authoritative items (#335).
      const seedItems =
        element.kind === "text" ? textContent(element).paragraphs : [];
      itemMetaRef.current = seedItems.map((it) => ({
        indent: it.indent ?? 0,
        listType: it.listType ?? "bullet",
      }));
      node.innerHTML =
        seedItems.length > 0
          ? seedItems
              .map((item) => `<div>${runsToHtml(item.runs, item.text)}</div>`)
              .join("")
          : "<div><br></div>";
      itemMetaRef.current = syncInlineListMarkers(node, itemMetaRef.current);
    }
    node.focus();
    const selection = window.getSelection();
    if (selection) {
      const caret = caretRef.current;
      const pointRange = caret ? caretRangeFromPoint(caret.x, caret.y) : null;
      if (pointRange && node.contains(pointRange.startContainer)) {
        pointRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(pointRange);
      } else {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    // Mount-only: intentionally not re-seeding on element changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style =
    kind === "shape"
      ? {
          ...defaultShapeTextStyle(),
          ...shapeTextDesign(
            element as Extract<SlideElement, { kind: "shape" }>,
          ),
        }
      : {
          fontSize: SLIDE_TEXT_FONT_SIZE.text,
          bold: false,
          italic: false,
          align: "left" as const,
          ...textDesign(element as Extract<SlideElement, { kind: "text" }>),
        };
  const resolvedFontSize = resolvedTextStyle?.fontSize ?? style.fontSize;
  const fitMode =
    kind === "text"
      ? textContent(element as Extract<SlideElement, { kind: "text" }>).fitMode
      : undefined;
  const shrinkScale = useInlineShrinkScale(
    ref,
    boundsRef,
    resolvedFontSize,
    fitMode,
  );
  const fontSizePx = ((resolvedFontSize * shrinkScale) / 100) * stageHeight;
  const verticalAlign =
    kind === "text"
      ? textDesign(element as Extract<SlideElement, { kind: "text" }>)
          .verticalAlign
      : undefined;

  // Mirror the static text element styles exactly
  // so entering edit mode is visually identical — no size / weight / line-height
  // jump. Vertical centering lives on the wrapper (below) to keep the editable
  // surface a plain block, which keeps caret / Enter behaviour predictable.
  const editableStyle = {
    width: "100%",
    color: resolvedTextStyle?.color ?? color,
    fontSize: `${fontSizePx}px`,
    fontWeight: resolvedTextStyle
      ? resolvedTextStyle.weight
      : style.bold
        ? 700
        : 400,
    fontStyle:
      (resolvedTextStyle?.italic ?? style.italic) ? "italic" : "normal",
    textAlign: resolvedTextStyle?.align ?? style.align,
    lineHeight: resolvedTextStyle?.lineHeight ?? (isListText ? 1.2 : 1.15),
    overflowWrap: "break-word",
    wordBreak: "normal",
    ...((resolvedTextStyle?.underline ?? style.underline)
      ? { textDecoration: "underline" }
      : {}),
    ...(resolvedTextStyle?.fontFamily
      ? { fontFamily: resolvedTextStyle.fontFamily }
      : resolveElementFontCss(style.fontId)
        ? { fontFamily: resolveElementFontCss(style.fontId) }
        : {}),
  } as CSSProperties & Record<string, string>;
  if (isListText) {
    editableStyle["--ds-bullet-accent"] = accent;
  }

  return (
    <div
      ref={boundsRef}
      className="absolute inset-0 flex flex-col justify-center overflow-hidden"
      style={{
        justifyContent:
          verticalAlign === "top"
            ? "flex-start"
            : verticalAlign === "bottom"
              ? "flex-end"
              : "center",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        // A click in the padding around the text should still focus the editor
        // rather than do nothing.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          ref.current?.focus();
        }
      }}
    >
      <div
        ref={ref}
        role="textbox"
        aria-label={
          isListText
            ? "Edit bullets"
            : kind === "shape"
              ? "Edit shape text"
              : "Edit text"
        }
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className={`outline-none${isListText ? " ds-inline-bullets" : ""}`}
        style={editableStyle}
        onInput={() => {
          dirtyRef.current = true;
          emitChange();
        }}
        onBlur={commit}
        onPaste={(event) => {
          // Paste as plain text so external rich markup never leaks into the
          // runs; formatting stays under the editor's own controls.
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          insertTextAtCursor(text);
          dirtyRef.current = true;
          emitChange();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            commit();
            return;
          }
          // Tab / Shift+Tab in bullet editing: change indent of current item (#335).
          if (isListText && event.key === "Tab") {
            event.preventDefault();
            const lineIdx = currentLineIndex();
            if (lineIdx >= 0) {
              const meta = itemMetaRef.current;
              if (!meta[lineIdx]) {
                meta[lineIdx] = { indent: 0, listType: "bullet" };
              }
              const cur = meta[lineIdx].indent;
              meta[lineIdx] = {
                ...meta[lineIdx],
                indent: event.shiftKey
                  ? Math.max(0, cur - 1)
                  : Math.min(5, cur + 1),
              };
              dirtyRef.current = true;
              emitChange();
            }
            return;
          }
          // Inline bold / italic shortcuts; re-serialize so the runs persist.
          if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === "b" || key === "i") {
              event.preventDefault();
              const node = ref.current;
              if (node) {
                applyBoldOrItalic(key === "b" ? "bold" : "italic", node);
              }
              dirtyRef.current = true;
              emitChange();
            }
          }
        }}
      />
    </div>
  );
}
