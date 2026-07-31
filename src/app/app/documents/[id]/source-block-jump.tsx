"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $isElementNode,
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

    const nodeKey = editor
      .getEditorState()
      .read(() => findNodeKeyByBlockId($getRoot(), blockId));
    if (!nodeKey) return;

    window.requestAnimationFrame(() => {
      const element = editor.getElementByKey(nodeKey);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    });
  }, [editor]);

  return null;
}
