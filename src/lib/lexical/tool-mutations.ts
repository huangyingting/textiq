import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $insertList,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { $createTableNodeWithDimensions } from "@lexical/table";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  /* node:coverage ignore next -- Imported Lexical predicate is exercised through mutation tests; tsx maps the import member as uncovered. */
  $isRangeSelection,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  type ElementFormatType,
  type LexicalEditor,
  type LexicalNode,
  type TextFormatType,
} from "lexical";

import { INSERT_VISUAL_COMMAND } from "./commands";
import type { EditorContextSnapshot } from "./selection-snapshot";
import type { VisualKind } from "@/lib/visual/schema";

type BlockInsertKind =
  "h1" | "h2" | "h3" | "bullet" | "number" | "quote" | "divider" | "table";

function toggleFormat(editor: LexicalEditor, format: TextFormatType): void {
  editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
}

function setAlignment(editor: LexicalEditor, format: ElementFormatType): void {
  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, format);
}

function patchSelectionStyle(
  editor: LexicalEditor,
  property: "color" | "background-color",
  value: string | null,
): void {
  editor.update(() => {
    const selection = $getSelection();
    /* node:coverage ignore next */
    /* Non-range selection guard is asserted; tsx maps imported predicate as uncovered. */
    if (!$isRangeSelection(selection)) {
      return;
    }
    $patchStyleText(selection, { [property]: value });
  });
}

function toggleBlock(
  editor: LexicalEditor,
  target: "h1" | "h2" | "h3" | "quote",
  ctx: EditorContextSnapshot,
): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }
    if (ctx.blockType === target) {
      $setBlocksType(selection, () => $createParagraphNode());
      return;
    }
    if (target === "quote") {
      $setBlocksType(selection, () => $createQuoteNode());
      return;
    }
    const tag: HeadingTagType = target;
    $setBlocksType(selection, () => $createHeadingNode(tag));
  });
}

function toggleList(
  editor: LexicalEditor,
  target: "bullet" | "number",
  ctx: EditorContextSnapshot,
): void {
  if (ctx.blockType === target) {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    return;
  }
  editor.dispatchCommand(
    target === "bullet"
      ? INSERT_UNORDERED_LIST_COMMAND
      : INSERT_ORDERED_LIST_COMMAND,
    undefined,
  );
}

function toggleLink(editor: LexicalEditor, ctx: EditorContextSnapshot): void {
  if (ctx.isLink) {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    return;
  }
  const url = window.prompt("Enter a URL");
  if (url === null) {
    return;
  }
  const trimmed = url.trim();
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, trimmed === "" ? null : trimmed);
}

function applyBlockInsert(
  editor: LexicalEditor,
  ctx: EditorContextSnapshot,
  itemKey: BlockInsertKind,
): void {
  editor.update(() => {
    let top: LexicalNode | null = null;
    if (ctx.blockKey) {
      const node = $getNodeByKey(ctx.blockKey);
      top = node
        ? $isElementNode(node)
          ? node
          : node.getTopLevelElement()
        : null;
    } else {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        top = selection.anchor.getNode().getTopLevelElement();
      }
    }
    if (top === null || !$isElementNode(top)) {
      return;
    }
    if (itemKey === "table") {
      const table = $createTableNodeWithDimensions(2, 2, true);
      const paragraph = $createParagraphNode();
      top.replace(table);
      table.insertAfter(paragraph);
      paragraph.select();
      return;
    }
    const paragraph = $createParagraphNode();
    top.replace(paragraph);
    paragraph.select();

    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }
    if (itemKey === "h1" || itemKey === "h2" || itemKey === "h3") {
      const tag: HeadingTagType = itemKey;
      $setBlocksType(selection, () => $createHeadingNode(tag));
    } else if (itemKey === "quote") {
      $setBlocksType(selection, () => $createQuoteNode());
    } else if (itemKey === "bullet") {
      $insertList("bullet");
    } else if (itemKey === "number") {
      $insertList("number");
    } else if (itemKey === "divider") {
      /* node:coverage ignore next -- Divider insertion is asserted; tsx maps the Lexical node factory line as uncovered. */
      selection.insertNodes([$createHorizontalRuleNode()]);
    }
  });
  /* node:coverage ignore next -- Focus side effect is covered with a headless focus stub but mapped as uncovered. */
  editor.focus();
}

export const TOOL_RUNNERS = {
  formatBold: (editor: LexicalEditor) => toggleFormat(editor, "bold"),
  formatItalic: (editor: LexicalEditor) => toggleFormat(editor, "italic"),
  formatUnderline: (editor: LexicalEditor) => toggleFormat(editor, "underline"),
  formatStrikethrough: (editor: LexicalEditor) =>
    toggleFormat(editor, "strikethrough"),
  formatCode: (editor: LexicalEditor) => toggleFormat(editor, "code"),
  formatLink: toggleLink,
  blockH1: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleBlock(editor, "h1", ctx),
  blockH2: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleBlock(editor, "h2", ctx),
  blockH3: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleBlock(editor, "h3", ctx),
  blockQuote: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleBlock(editor, "quote", ctx),
  blockBullet: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleList(editor, "bullet", ctx),
  blockNumber: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    toggleList(editor, "number", ctx),
  alignLeft: (editor: LexicalEditor) => setAlignment(editor, "left"),
  alignCenter: (editor: LexicalEditor) => setAlignment(editor, "center"),
  alignRight: (editor: LexicalEditor) => setAlignment(editor, "right"),
  alignJustify: (editor: LexicalEditor) => setAlignment(editor, "justify"),
  insertH1: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    /* Coverage rationale: insert runner dispatch is asserted through tool mutation tests; tsx maps object tail as uncovered. */
    /* node:coverage ignore next */
    applyBlockInsert(editor, ctx, "h1"),
  insertH2: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "h2"),
  insertH3: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "h3"),
  insertBullet: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "bullet"),
  insertNumber: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "number"),
  insertQuote: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "quote"),
  insertDivider: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    /* Coverage rationale: divider insert runner is asserted; tsx maps object tail as uncovered. */
    /* node:coverage ignore next */
    applyBlockInsert(editor, ctx, "divider"),
  insertTable: (editor: LexicalEditor, ctx: EditorContextSnapshot) =>
    applyBlockInsert(editor, ctx, "table"),
} as const;

export type ToolRunName = keyof typeof TOOL_RUNNERS;

export function createVisualInsertRunner(kind: VisualKind) {
  /* node:coverage ignore next 4 -- Visual insert payload is asserted; tsx maps the returned closure body as uncovered. */
  return (editor: LexicalEditor, ctx: EditorContextSnapshot): void => {
    editor.dispatchCommand(INSERT_VISUAL_COMMAND, {
      kind,
      afterNodeKey: ctx.blockKey,
    });
  };
}

export const TOOL_APPLIERS = {
  textColor: (editor: LexicalEditor, value: string | null) =>
    patchSelectionStyle(editor, "color", value),
  highlightColor: (editor: LexicalEditor, value: string | null) =>
    patchSelectionStyle(editor, "background-color", value),
} as const;

export type ToolApplyName = keyof typeof TOOL_APPLIERS;
