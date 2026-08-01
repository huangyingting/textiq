"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";

import { VisualNode } from "@/lib/lexical/visual-node";
import { $getNodeBlockId } from "@/lib/lexical/block-id-runtime";

function nodeBlockId(node: LexicalNode): string | undefined {
  if (node instanceof VisualNode) return node.getVisualId();
  return $getNodeBlockId(node);
}

function findNodeKeyByBlockId(
  node: ElementNode,
  blockId: string,
): string | undefined {
  for (const child of node.getChildren()) {
    if (nodeBlockId(child) === blockId) return child.getKey();
    if ($isElementNode(child)) {
      const nested = findNodeKeyByBlockId(child, blockId);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function SourceBlockJumpPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const blockId = params.get("sourceBlock");
    if (!blockId) return;

    let cancelled = false;
    let completed = false;
    let frameId: number | null = null;

    const jumpWhenReady = () => {
      if (cancelled || completed || frameId !== null) return;

      const nodeKey = editor
        .getEditorState()
        .read(() => findNodeKeyByBlockId($getRoot(), blockId));
      if (!nodeKey) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (cancelled || completed) return;
        completed = true;

        const element = editor.getElementByKey(nodeKey);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });

        let selected = false;
        editor.update(
          () => {
            const node = $getNodeByKey(nodeKey);
            if (!node) return;

            if ($isElementNode(node)) {
              node.selectStart();
            } else {
              const selection = $createNodeSelection();
              selection.add(nodeKey);
              $setSelection(selection);
            }
            selected = true;
          },
          { discrete: true },
        );
        if (!selected) {
          completed = false;
          jumpWhenReady();
          return;
        }

        editor.getRootElement()?.focus({ preventScroll: true });
        editor.focus();
        unregisterUpdate();
      });
    };

    const unregisterUpdate = editor.registerUpdateListener(jumpWhenReady);
    jumpWhenReady();

    return () => {
      cancelled = true;
      unregisterUpdate();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [editor]);

  return null;
}
