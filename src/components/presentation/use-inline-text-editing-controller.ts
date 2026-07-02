"use client";

import { useState } from "react";

import type { InlineTextInitialCaret } from "./inline-text-editor";

export function escapeInlineEditorSelectorValue(nodeId: string): string {
  return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface InlineTextEditingController {
  inlineEditNodeId: string | null;
  inlineEditInitialCaret: InlineTextInitialCaret | null;
  enterInlineEdit: (
    nodeId: string,
    initialCaret?: InlineTextInitialCaret | null,
  ) => void;
  exitInlineEdit: () => void;
  requestInlineEditCommit: () => void;
}

export function useInlineTextEditingController(): InlineTextEditingController {
  const [inlineEditNodeId, setInlineEditNodeId] = useState<string | null>(null);
  const [inlineEditInitialCaret, setInlineEditInitialCaret] =
    useState<InlineTextInitialCaret | null>(null);

  function enterInlineEdit(
    nodeId: string,
    initialCaret: InlineTextInitialCaret | null = null,
  ) {
    setInlineEditInitialCaret(initialCaret);
    setInlineEditNodeId(nodeId);
  }

  function exitInlineEdit() {
    setInlineEditInitialCaret(null);
    setInlineEditNodeId(null);
  }

  function requestInlineEditCommit() {
    if (!inlineEditNodeId) return;
    if (typeof document === "undefined") {
      exitInlineEdit();
      return;
    }
    const editor = document.querySelector(
      `[data-inline-editor-presentation="${escapeInlineEditorSelectorValue(
        inlineEditNodeId,
      )}"]`,
    );
    const blur = (editor as { blur?: unknown } | null)?.blur;
    if (typeof blur === "function") {
      blur.call(editor);
      return;
    }
    exitInlineEdit();
  }

  return {
    inlineEditNodeId,
    inlineEditInitialCaret,
    enterInlineEdit,
    exitInlineEdit,
    requestInlineEditCommit,
  };
}
