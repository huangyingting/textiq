import { $isLinkNode } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $getSelectionStyleValueForProperty } from "@lexical/selection";
import { $getNearestNodeOfType } from "@lexical/utils";
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type ElementFormatType,
  type LexicalNode,
} from "lexical";

import { $getSelectedDocumentTableKey } from "@/lib/lexical/table-controls";

export type EditorContextKind =
  "range" | "collapsed" | "empty-block" | "visual" | "table" | "none";

export type EditorBlockType =
  "paragraph" | "h1" | "h2" | "h3" | "quote" | "bullet" | "number";

export type EditorTextFormat =
  "bold" | "italic" | "underline" | "strikethrough" | "code";

export type RectSnapshot = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type EditorContextRects = {
  selection: RectSnapshot | null;
  block: RectSnapshot | null;
};

export type EditorContextSnapshot = {
  kind: EditorContextKind;
  editable: boolean;
  isCollapsed: boolean;
  blockType?: EditorBlockType;
  activeFormats: Set<EditorTextFormat>;
  elementFormat: ElementFormatType;
  textColor: string;
  highlightColor: string;
  isLink: boolean;
  /** Live Lexical key of the active top-level block (transient — never stored). */
  blockKey?: string;
  /** Stable durable block id (`bid`) of the active top-level block. */
  blockBid?: string;
  blockText?: string;
  selectionText?: string;
  /** Live Lexical key of the range end block (transient — never stored). */
  selectionEndBlockKey?: string;
  /** Stable durable block id (`bid`) of the range end block. */
  selectionEndBlockBid?: string;
  isEmptyBlock: boolean;
  /** Stable visual id of the selected VisualNode (safe to persist/anchor). */
  selectedVisualId?: string;
  /** Live Lexical key of the selected VisualNode (transient — never stored). */
  selectedVisualNodeKey?: string;
  /** Live Lexical key of the active TableNode (transient — never stored). */
  selectedTableNodeKey?: string;
  rects: EditorContextRects;
};

export type SelectionDescriptor = Pick<
  EditorContextSnapshot,
  | "kind"
  | "isCollapsed"
  | "blockType"
  | "activeFormats"
  | "elementFormat"
  | "textColor"
  | "highlightColor"
  | "isLink"
  | "blockKey"
  | "blockBid"
  | "blockText"
  | "selectionText"
  | "selectionEndBlockKey"
  | "selectionEndBlockBid"
  | "isEmptyBlock"
  | "selectedVisualId"
  | "selectedVisualNodeKey"
  | "selectedTableNodeKey"
>;

export type StableSelectionSnapshot = Omit<
  SelectionDescriptor,
  | "activeFormats"
  | "blockKey"
  | "selectionEndBlockKey"
  | "selectedVisualNodeKey"
  | "selectedTableNodeKey"
> & {
  activeFormats: EditorTextFormat[];
};

const EMPTY_DESCRIPTOR: SelectionDescriptor = {
  kind: "none",
  isCollapsed: true,
  activeFormats: new Set(),
  elementFormat: "",
  textColor: "",
  highlightColor: "",
  isLink: false,
  isEmptyBlock: false,
};

const TEXT_FORMATS: EditorTextFormat[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
];

function getBlockType(node: LexicalNode): EditorBlockType {
  const element =
    node.getKey() === "root" ? node : (node.getTopLevelElement() ?? node);

  const listNode = $getNearestNodeOfType(node, ListNode);
  if (listNode && $isListNode(listNode)) {
    return listNode.getListType() === "number" ? "number" : "bullet";
  }
  if ($isHeadingNode(element)) {
    const tag = element.getTag();
    if (tag === "h1") return "h1";
    if (tag === "h2") return "h2";
    if (tag === "h3") return "h3";
  }
  if ($isQuoteNode(element)) {
    return "quote";
  }
  return "paragraph";
}

function readNodeBid(node: LexicalNode | null | undefined): string | undefined {
  const bid = (node as (LexicalNode & { __bid?: unknown }) | null | undefined)
    ?.__bid;
  return typeof bid === "string" && bid.length > 0 ? bid : undefined;
}

/**
 * Pure selection-derivation: reads the current Lexical selection and returns the
 * rect-free subset of {@link EditorContextSnapshot}. Must be invoked inside an
 * `editorState.read(...)` or `editor.update(...)` callback.
 */
export function readSelectionDescriptor(): SelectionDescriptor {
  const selection = $getSelection();

  if ($isNodeSelection(selection)) {
    for (const node of selection.getNodes()) {
      if (node.getType() === "visual") {
        const withId = node as LexicalNode & {
          getVisualId?: () => string;
        };
        return {
          ...EMPTY_DESCRIPTOR,
          kind: "visual",
          selectedVisualId:
            typeof withId.getVisualId === "function"
              ? withId.getVisualId()
              : undefined,
          selectedVisualNodeKey: node.getKey(),
        };
      }
    }
    return EMPTY_DESCRIPTOR;
  }

  if (!$isRangeSelection(selection)) {
    const tableKey = $getSelectedDocumentTableKey();
    if (tableKey !== null) {
      return {
        ...EMPTY_DESCRIPTOR,
        kind: "table",
        selectedTableNodeKey: tableKey,
      };
    }
    return EMPTY_DESCRIPTOR;
  }

  /* node:coverage ignore next 30 */ /* Range selection derivation is asserted in editor-context.test.ts; tsx maps this covered block as uncovered. */
  const anchorNode = selection.anchor.getNode();
  const topLevel =
    anchorNode.getKey() === "root" ? null : anchorNode.getTopLevelElement();

  const activeFormats = new Set<EditorTextFormat>();
  for (const format of TEXT_FORMATS) {
    if (selection.hasFormat(format)) {
      activeFormats.add(format);
    }
  }

  const isLink = selection.getNodes().some((node) => {
    const parent = node.getParent();
    return $isLinkNode(node) || (parent !== null && $isLinkNode(parent));
  });

  const blockType = getBlockType(anchorNode);
  const blockKey = topLevel?.getKey();
  const blockBid = readNodeBid(topLevel);
  const blockText = topLevel?.getTextContent() ?? "";
  const selectionText = selection.getTextContent();
  const selectedNodes = selection.getNodes();
  const selectionEndBlock =
    selectedNodes[selectedNodes.length - 1]?.getTopLevelElement() ?? topLevel;
  const selectionEndBlockKey = selectionEndBlock?.getKey();
  const selectionEndBlockBid = readNodeBid(selectionEndBlock);
  const isCollapsed = selection.isCollapsed();
  const isEmptyBlock =
    isCollapsed && blockType === "paragraph" && blockText.trim() === "";
  const elementFormat: ElementFormatType =
    topLevel !== null ? topLevel.getFormatType() : "";
  const textColor = $getSelectionStyleValueForProperty(selection, "color", "");
  const highlightColor = $getSelectionStyleValueForProperty(
    selection,
    "background-color",
    "",
  );

  let kind: EditorContextKind;
  const selectedTableNodeKey = $getSelectedDocumentTableKey() ?? undefined;
  if (!isCollapsed && selectionText.trim() !== "") {
    kind = "range";
  } else if (selectedTableNodeKey !== undefined) {
    kind = "table";
  } else if (isEmptyBlock) {
    kind = "empty-block";
  } else if (topLevel !== null) {
    kind = "collapsed";
  } else {
    kind = "none";
  }

  return {
    kind,
    isCollapsed,
    blockType,
    activeFormats,
    elementFormat,
    textColor,
    highlightColor,
    isLink,
    blockKey,
    blockBid,
    blockText,
    selectionText,
    selectionEndBlockKey,
    selectionEndBlockBid,
    isEmptyBlock,
    selectedTableNodeKey,
  };
}

export function stableSelectionSnapshot(
  descriptor: SelectionDescriptor,
): StableSelectionSnapshot {
  const {
    activeFormats,
    blockKey: _blockKey,
    selectionEndBlockKey: _selectionEndBlockKey,
    selectedVisualNodeKey: _selectedVisualNodeKey,
    ...stable
  } = descriptor;
  return {
    ...stable,
    activeFormats: Array.from(activeFormats).sort(),
  };
}

function sameFormats(
  a: Set<EditorTextFormat>,
  b: Set<EditorTextFormat>,
): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function sameRect(a: RectSnapshot | null, b: RectSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.height === b.height
  );
}

export function snapshotsEqual(
  a: EditorContextSnapshot,
  b: EditorContextSnapshot,
): boolean {
  return (
    a.kind === b.kind &&
    a.editable === b.editable &&
    a.isCollapsed === b.isCollapsed &&
    a.blockType === b.blockType &&
    a.elementFormat === b.elementFormat &&
    a.textColor === b.textColor &&
    a.highlightColor === b.highlightColor &&
    a.isLink === b.isLink &&
    a.blockKey === b.blockKey &&
    a.blockBid === b.blockBid &&
    a.blockText === b.blockText &&
    a.selectionText === b.selectionText &&
    a.selectionEndBlockKey === b.selectionEndBlockKey &&
    a.selectionEndBlockBid === b.selectionEndBlockBid &&
    a.isEmptyBlock === b.isEmptyBlock &&
    a.selectedVisualId === b.selectedVisualId &&
    a.selectedVisualNodeKey === b.selectedVisualNodeKey &&
    a.selectedTableNodeKey === b.selectedTableNodeKey &&
    sameFormats(a.activeFormats, b.activeFormats) &&
    sameRect(a.rects.selection, b.rects.selection) &&
    sameRect(a.rects.block, b.rects.block)
  );
}
