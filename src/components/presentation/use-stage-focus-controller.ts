"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { Deck, SlideChildNode } from "@/lib/presentation/schema";
import type { StageFitSize } from "@/lib/presentation/stage-fit";

import {
  createFocusGeometryRegistry,
  focusGeometryTargets,
} from "./focus-geometry-registry";
import {
  clearSelection,
  setSelection as setSelectedNodeIds,
  type SelectionState,
} from "./selection-model";
import { findNodeById } from "./selection-traversal";

/* node:coverage ignore next 14 */
export function useFocusFirstDescendantWhenOpen(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusTarget = panel.querySelector<HTMLElement>(
      "input, select, button, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus();
  }, [open, panelRef]);
}

/* node:coverage ignore next 23 */
export function focusStageNode(
  focusGeometryRegistry: ReturnType<typeof createFocusGeometryRegistry>,
  nodeId: string,
): void {
  focusGeometryRegistry.focus(focusGeometryTargets.stageNode(nodeId));
}

/**
 * Finds the slide index that owns a node id (searching nested group children),
 * or, failing that, the index of a slide whose own id matches. Returns -1 when
 * the id is no longer present in the deck.
 */
export function findSlideIndexForFocus(deck: Deck, targetId: string): number {
  const containsNode = (nodes: readonly SlideChildNode[]): boolean =>
    nodes.some(
      (node) =>
        node.id === targetId ||
        (node.type === "group" && containsNode(node.children)),
    );
  const byNode = deck.slides.findIndex((slide) => containsNode(slide.children));
  if (byNode !== -1) return byNode;
  return deck.slides.findIndex((slide) => slide.id === targetId);
}

/* node:coverage ignore next 10 */
function scheduleEffectStateUpdate(callback: () => void): () => void {
  let canceled = false;
  const timeoutId = globalThis.setTimeout(() => {
    if (!canceled) callback();
  }, 0);
  return () => {
    canceled = true;
    globalThis.clearTimeout(timeoutId);
  };
}

export interface UndoRedoFocusTarget {
  nodeId: string;
  token: number;
}

/* node:coverage ignore next 165 */
export interface UseStageFocusControllerArgs {
  editorRootRef: RefObject<HTMLDivElement | null>;
  deck: Deck;
  undoRedoFocus: UndoRedoFocusTarget | null;
  setActiveSlideIndex: Dispatch<SetStateAction<number>>;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  setFocusedNodeId: Dispatch<SetStateAction<string | null>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  exitInlineEdit: () => void;
}

export function useStageFocusController({
  editorRootRef,
  deck,
  undoRedoFocus,
  setActiveSlideIndex,
  setSelection,
  setFocusedNodeId,
  setHoveredNodeId,
  exitInlineEdit,
}: UseStageFocusControllerArgs) {
  const focusGeometryRegistry = useMemo(
    () => createFocusGeometryRegistry(),
    [],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [stageViewportSize, setStageViewportSize] =
    useState<StageFitSize | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const lastUndoRedoFocusTokenRef = useRef<number | null>(null);

  const handleCanvasRef = useCallback((el: HTMLDivElement | null) => {
    setCanvasElement(el);
  }, []);

  const focusStageNodeSoon = useCallback(
    (nodeId: string) => {
      window.setTimeout(() => focusStageNode(focusGeometryRegistry, nodeId), 0);
    },
    [focusGeometryRegistry],
  );

  const focusEditorRootSoon = useCallback(() => {
    window.setTimeout(() => editorRootRef.current?.focus(), 0);
  }, [editorRootRef]);

  const focusSelectedNodeSoon = useCallback(
    (nodeId: string | undefined) => {
      if (!nodeId) return;
      setFocusedNodeId(nodeId);
      focusStageNodeSoon(nodeId);
    },
    [focusStageNodeSoon, setFocusedNodeId],
  );

  const focusStageViewportSoon = useCallback(() => {
    window.setTimeout(() => {
      const stageViewport = stageViewportRef.current;
      if (stageViewport) {
        stageViewport.focus();
        return;
      }
      editorRootRef.current?.focus();
    }, 0);
  }, [editorRootRef]);

  useEffect(() => {
    if (!undoRedoFocus) return;
    if (lastUndoRedoFocusTokenRef.current === undoRedoFocus.token) return;
    lastUndoRedoFocusTokenRef.current = undoRedoFocus.token;
    const nextSlideIndex = findSlideIndexForFocus(deck, undoRedoFocus.nodeId);
    const targetSlide = deck.slides[nextSlideIndex];
    const targetNode = targetSlide
      ? findNodeById(targetSlide.children, undoRedoFocus.nodeId)
      : undefined;
    return scheduleEffectStateUpdate(() => {
      if (nextSlideIndex < 0) {
        setSelection((s) => clearSelection(s));
        setFocusedNodeId(null);
        exitInlineEdit();
        focusEditorRootSoon();
        return;
      }

      setActiveSlideIndex(nextSlideIndex);
      exitInlineEdit();
      setHoveredNodeId(null);
      if (targetNode) {
        setSelection((s) => setSelectedNodeIds(s, [targetNode.id]));
        setFocusedNodeId(targetNode.id);
        focusStageNodeSoon(targetNode.id);
        return;
      }

      setSelection((s) => clearSelection(s));
      setFocusedNodeId(null);
      focusEditorRootSoon();
    });
  }, [
    deck,
    exitInlineEdit,
    focusEditorRootSoon,
    focusStageNodeSoon,
    setActiveSlideIndex,
    setFocusedNodeId,
    setHoveredNodeId,
    setSelection,
    undoRedoFocus,
  ]);

  useEffect(() => {
    const node = stageViewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let frameId: number | null = null;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const paddingX =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const paddingY =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const next = {
        width: Math.max(1, rect.width - paddingX),
        height: Math.max(1, rect.height - paddingY),
      };
      setStageViewportSize((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const scheduleMeasure = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(node);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  return {
    focusGeometryRegistry,
    canvasElement,
    handleCanvasRef,
    stageViewportRef,
    stageViewportSize,
    focusSelectedNodeSoon,
    focusStageViewportSoon,
    focusEditorRootSoon,
    focusStageNodeSoon,
  };
}
