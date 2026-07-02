"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";

import type {
  DeckV7,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation-vnext/schema";
import { updateNodeContent } from "@/lib/presentation-vnext";
import {
  applyPlainTextEditToTableContent,
  clampTableCellNavigation,
  wrapTableCellNavigation,
} from "@/lib/presentation-vnext/table-cell-editing";

import {
  setSelection as setSelectedNodeIds,
  type SelectionState,
} from "./selection-model";

export type TableCellNavigationAction =
  | { kind: "exit" }
  | { kind: "linear"; direction: 1 | -1 }
  | { kind: "grid"; rowDelta: number; colDelta: number }
  | null;

export function resolveTableCellNavigationAction(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): TableCellNavigationAction {
  if (event.key === "Escape") {
    return { kind: "exit" };
  }
  if (event.key === "Tab") {
    return { kind: "linear", direction: event.shiftKey ? -1 : 1 };
  }

  const movement: Record<string, [number, number] | undefined> = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  };
  const delta = movement[event.key];
  if (!delta || (!event.metaKey && !event.ctrlKey && !event.altKey)) {
    return null;
  }
  return { kind: "grid", rowDelta: delta[0], colDelta: delta[1] };
}

interface EnterTableEditOptions {
  announcement?: string;
}

interface UseTableCellEditingOptions {
  deck: DeckV7;
  activeSlide: SlideNode | undefined;
  selectedNodeId: string | undefined;
  selectedNodeIds: readonly string[];
  findNodeById: (
    nodes: readonly SlideChildNode[],
    id: string,
  ) => SlideChildNode | undefined;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  setFocusedNodeId: Dispatch<SetStateAction<string | null>>;
  onDeckChange: (nextDeck: DeckV7) => void;
  setStageAnnouncement: Dispatch<SetStateAction<string>>;
  focusSelectedNodeSoon: (nodeId: string | undefined) => void;
}

function focusTableCellSoon(
  nodeId: string,
  rowIndex: number,
  colIndex: number,
): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const safeId = nodeId.replace(/"/g, '\\"');
    const cell = document.querySelector<HTMLElement>(
      `[data-node-id="${safeId}"] [data-table-cell="${rowIndex}:${colIndex}"]`,
    );
    cell?.focus();
  }, 0);
}

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

export function useTableCellEditing({
  deck,
  activeSlide,
  selectedNodeId,
  selectedNodeIds,
  findNodeById,
  setSelection,
  setFocusedNodeId,
  onDeckChange,
  setStageAnnouncement,
  focusSelectedNodeSoon,
}: UseTableCellEditingOptions) {
  const [tableEditingNodeId, setTableEditingNodeId] = useState<string | null>(
    null,
  );
  const [activeTableCell, setActiveTableCell] = useState<{
    rowIndex: number;
    colIndex: number;
  } | null>(null);

  const clearTableEditing = useCallback(() => {
    setTableEditingNodeId(null);
    setActiveTableCell(null);
  }, []);

  useEffect(() => {
    if (!tableEditingNodeId) return;

    return scheduleEffectStateUpdate(() => {
      const selectedOnlyEditingNode =
        selectedNodeIds.length === 1 &&
        selectedNodeIds[0] === tableEditingNodeId;
      const editingNode = activeSlide
        ? findNodeById(activeSlide.children, tableEditingNodeId)
        : undefined;

      if (!selectedOnlyEditingNode || editingNode?.type !== "table") {
        clearTableEditing();
      }
    });
  }, [
    activeSlide,
    clearTableEditing,
    findNodeById,
    selectedNodeIds,
    tableEditingNodeId,
  ]);

  const handleEnterTableEdit = useCallback(
    (nodeId = selectedNodeId, options?: EnterTableEditOptions) => {
      if (!activeSlide || !nodeId) return;
      const node = findNodeById(activeSlide.children, nodeId);
      if (!node || node.type !== "table") return;
      setSelection((state) => setSelectedNodeIds(state, [node.id]));
      setFocusedNodeId(node.id);
      setTableEditingNodeId(node.id);
      setActiveTableCell({ rowIndex: 0, colIndex: 0 });
      focusTableCellSoon(node.id, 0, 0);
      setStageAnnouncement(
        options?.announcement ??
          "Editing table cells. Use Tab or arrow keys to move.",
      );
    },
    [
      activeSlide,
      findNodeById,
      selectedNodeId,
      setFocusedNodeId,
      setSelection,
      setStageAnnouncement,
    ],
  );

  const handleTableCellFocus = useCallback(
    (nodeId: string, rowIndex: number, colIndex: number) => {
      setTableEditingNodeId(nodeId);
      setActiveTableCell({ rowIndex, colIndex });
      setFocusedNodeId(nodeId);
      if (!selectedNodeIds.includes(nodeId)) {
        setSelection((state) => setSelectedNodeIds(state, [nodeId]));
      }
    },
    [selectedNodeIds, setFocusedNodeId, setSelection],
  );

  const handleTableCellCommit = useCallback(
    (nodeId: string, rowIndex: number, colIndex: number, text: string) => {
      if (!activeSlide) return;
      const node = findNodeById(activeSlide.children, nodeId);
      if (!node || node.type !== "table") return;
      const nextContent = applyPlainTextEditToTableContent(
        node.content,
        rowIndex,
        colIndex,
        text,
      );
      if (nextContent === node.content) return;
      onDeckChange(
        updateNodeContent(deck, activeSlide.id, nodeId, {
          rows: nextContent.rows,
        }),
      );
    },
    [activeSlide, deck, findNodeById, onDeckChange],
  );

  const moveTableCellFocus = useCallback(
    (
      nodeId: string,
      rowIndex: number,
      colIndex: number,
      rowDelta: number,
      colDelta: number,
    ) => {
      if (!activeSlide) return;
      const node = findNodeById(activeSlide.children, nodeId);
      if (!node || node.type !== "table") return;
      const nextCell = clampTableCellNavigation({
        rowCount: node.content.rows.length,
        colCount: node.content.columns.length,
        rowIndex,
        colIndex,
        rowDelta,
        colDelta,
      });
      if (!nextCell) return;
      setActiveTableCell(nextCell);
      focusTableCellSoon(nodeId, nextCell.rowIndex, nextCell.colIndex);
    },
    [activeSlide, findNodeById],
  );

  const moveTableCellFocusLinear = useCallback(
    (nodeId: string, rowIndex: number, colIndex: number, direction: 1 | -1) => {
      if (!activeSlide) return;
      const node = findNodeById(activeSlide.children, nodeId);
      if (!node || node.type !== "table") return;
      const nextCell = wrapTableCellNavigation({
        rowCount: node.content.rows.length,
        colCount: node.content.columns.length,
        rowIndex,
        colIndex,
        direction,
      });
      if (!nextCell) return;
      setActiveTableCell(nextCell);
      focusTableCellSoon(nodeId, nextCell.rowIndex, nextCell.colIndex);
    },
    [activeSlide, findNodeById],
  );

  const handleTableCellKeyDown = useCallback(
    (
      nodeId: string,
      rowIndex: number,
      colIndex: number,
      event: KeyboardEvent<HTMLElement>,
    ) => {
      const action = resolveTableCellNavigationAction(event);
      if (!action) return;

      if (action.kind === "exit") {
        clearTableEditing();
        focusSelectedNodeSoon(nodeId);
      } else if (action.kind === "linear") {
        moveTableCellFocusLinear(nodeId, rowIndex, colIndex, action.direction);
      } else {
        moveTableCellFocus(
          nodeId,
          rowIndex,
          colIndex,
          action.rowDelta,
          action.colDelta,
        );
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [
      clearTableEditing,
      focusSelectedNodeSoon,
      moveTableCellFocus,
      moveTableCellFocusLinear,
    ],
  );

  return {
    tableEditingNodeId,
    activeTableCell,
    clearTableEditing,
    handleEnterTableEdit,
    handleTableCellFocus,
    handleTableCellCommit,
    handleTableCellKeyDown,
  };
}
