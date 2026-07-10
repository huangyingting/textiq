"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $nodesOfType } from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";

import { useVisualSvgRegistry } from "@/components/editor/visual-svg-registry";
import { applyVisualCommand } from "@/lib/commands/visual-command-adapter";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";
import { BRAND_WEB_FONTS } from "@/lib/brand/schema";
import type { BrandStyle } from "@/lib/brand/schema";
import { applyBrand } from "@/lib/brand/transforms";
import { useEditorContext } from "@/lib/lexical/editor-context";
import { applyElasticLayout } from "@/lib/visual/transforms";
import type { Visual } from "@/lib/visual/schema";

import { VisualContextPopover } from "./visual-context-popover";
import { useVisualPanel } from "./visual-panel-context";
import { $isVisualNode, VisualNode } from "@/lib/lexical/visual-node";

const SOURCE_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "quote",
  "list",
]);

export function VisualContextSection() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const { activeVisual, onClose, selectedNodeId } = useVisualPanel();
  const svgRegistry = useVisualSvgRegistry();

  const [panelState, setPanelState] = useState<{
    visual: Visual;
    nodeKey: string;
    visualId: string;
    currentSourceText: string | undefined;
  } | null>(null);

  const nodeKey = activeVisual?.nodeKey ?? ctx.selectedVisualNodeKey;
  const visualId = activeVisual?.visualId ?? ctx.selectedVisualId;

  useEffect(() => {
    if (!nodeKey || !visualId) return;

    const readData = () => {
      editor.read(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isVisualNode(node)) {
          setPanelState(null);
          return;
        }
        const prev = node.getPreviousSibling();
        let srcText: string | undefined;
        if (prev !== null && SOURCE_TEXT_BLOCK_TYPES.has(prev.getType())) {
          const text = prev.getTextContent().trim();
          srcText = text || undefined;
        }
        setPanelState({
          visual: node.getVisual(),
          nodeKey,
          visualId: node.getVisualId(),
          currentSourceText: srcText,
        });
      });
    };

    readData();
    return editor.registerUpdateListener(readData);
  }, [nodeKey, visualId, editor]);

  const visualData = panelState?.nodeKey === nodeKey ? panelState : null;

  const updateVisual = useCallback(
    (next: Visual) => {
      if (!visualData) return;
      const key = visualData.nodeKey;
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isVisualNode(node)) {
          node.setVisual(applyElasticLayout(next));
        }
      });
    },
    [editor, visualData],
  );

  const handleCommand = useCallback(
    (payload: VisualCommandPayload, coalesceKey?: string) => {
      if (!visualData) return;
      const key = visualData.nodeKey;
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (!$isVisualNode(node)) {
          return;
        }
        const result = applyVisualCommand(
          node.getVisual(),
          node.getVisualId(),
          payload,
          undefined,
          coalesceKey,
        );
        if (result.ok) {
          node.setVisual(applyElasticLayout(result.visual));
        }
      });
    },
    [editor, visualData],
  );

  const removeVisual = useCallback(() => {
    if (!visualData) return;
    const key = visualData.nodeKey;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isVisualNode(node)) {
        node.remove();
      }
    });
  }, [editor, visualData]);

  const applyBrandToAll = useCallback(
    (brand: BrandStyle) => {
      if (brand.fontFamily) {
        const match = BRAND_WEB_FONTS.find(
          (f) => f.cssFamily === brand.fontFamily,
        );
        if (match) {
          const id = `gfont-brand-${match.id}`;
          if (!document.getElementById(id)) {
            const link = document.createElement("link");
            link.id = id;
            link.rel = "stylesheet";
            link.href = match.url;
            document.head.appendChild(link);
          }
        }
      }
      editor.update(() => {
        const nodes = $nodesOfType(VisualNode);
        for (const node of nodes) {
          node.setVisual(
            applyElasticLayout(applyBrand(node.getVisual(), brand)),
          );
        }
      });
    },
    [editor],
  );

  const getSvgElement = useCallback(() => {
    if (!visualData?.visualId) return null;
    return svgRegistry?.get(visualData.visualId)?.() ?? null;
  }, [svgRegistry, visualData]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const dummyAnchorRef = useRef<HTMLElement | null>(null);

  if (!visualData) return null;

  return (
    <VisualContextPopover
      mode="panel"
      visualId={visualData.visualId}
      visual={visualData.visual}
      selectedNodeId={selectedNodeId}
      onChange={updateVisual}
      onCommand={handleCommand}
      onRemove={removeVisual}
      onClose={handleClose}
      getSvgElement={getSvgElement}
      anchorRef={dummyAnchorRef}
      currentSourceText={visualData.currentSourceText}
      onApplyBrandToAll={applyBrandToAll}
    />
  );
}
