"use client";

import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Group,
  Layers,
  Lock,
  Scissors,
  Trash2,
  Ungroup,
  Unlock,
  type LucideIcon,
} from "lucide-react";

import type { SlideChildNode } from "@/lib/presentation/schema";
import {
  focusFirstMenuCommand,
  isMenuCommandNavigationKey,
  moveMenuCommandFocus,
} from "@/lib/a11y/menu-command-semantics";
import { cx, MENU_CHROME } from "@/components/ui/tokens";
import { nextSemanticSelectUnderNodeId } from "./stage-pointer-interactions";

export function stageNodeMenuLabel(node: SlideChildNode): string {
  if (node.name) return node.name;
  if (node.type === "text") {
    const text = node.content.paragraphs
      .map((paragraph) => paragraph.text)
      .join(" ")
      .trim();
    return text ? `Text: ${text}` : "Text";
  }
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

export function nextUnlockedContextLayerId(
  candidates: readonly SlideChildNode[],
  currentNodeId: string,
): string | null {
  return nextSemanticSelectUnderNodeId(
    candidates
      .filter(
        (candidate) => candidate.locked !== true && candidate.hidden !== true,
      )
      .map((candidate) => candidate.id),
    new Set([currentNodeId]),
  );
}

export function selectableContextLayers(
  candidates: readonly SlideChildNode[],
): SlideChildNode[] {
  return candidates.filter(
    (candidate) => candidate.locked !== true && candidate.hidden !== true,
  );
}

export function overlapContextLayers(
  candidates: readonly SlideChildNode[],
): SlideChildNode[] {
  const selectableCandidates = selectableContextLayers(candidates);
  return selectableCandidates.length > 1 ? selectableCandidates : [];
}

export function StageNodeContextMenu({
  x,
  y,
  node,
  candidates,
  selectedCount,
  canPaste,
  canGroup,
  canUngroup,
  onClose,
  onSelectCandidate,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onToggleLock,
  onToggleHidden,
  onDetachConnectorFrom,
  onDetachConnectorTo,
  onGroup,
  onUngroup,
}: {
  x: number;
  y: number;
  node: SlideChildNode;
  candidates: readonly SlideChildNode[];
  selectedCount: number;
  canPaste: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  onClose: () => void;
  onSelectCandidate: (nodeId: string) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onToggleHidden: () => void;
  onDetachConnectorFrom: () => void;
  onDetachConnectorTo: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    focusFirstMenuCommand(menu);

    function onPointerDown(event: PointerEvent) {
      if (!menu) return;
      if (!menu.contains(event.target as Node)) onClose();
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const menuWidth = 320;
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 560));
  const layerCandidates = overlapContextLayers(candidates);
  const nextUnlockedLayerId = nextUnlockedContextLayerId(
    layerCandidates,
    node.id,
  );
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const item = (
    label: string,
    icon: LucideIcon,
    onSelect: () => void,
    options: { disabled?: boolean; shortcut?: string } = {},
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={options.disabled}
        className={cx(
          "flex min-h-11 w-full items-center gap-3 rounded-ds-md px-3 py-2 text-left text-[13px] font-medium text-ds-text-primary transition-colors hover:bg-ds-state-hover disabled:pointer-events-none disabled:text-ds-text-muted disabled:opacity-45",
        )}
        onClick={run(onSelect)}
      >
        <Icon size={20} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {options.shortcut ? (
          <span className="shrink-0 rounded-ds-md bg-ds-surface-sunken px-2 py-1 font-mono text-[11px] font-normal text-ds-text-secondary">
            {options.shortcut}
          </span>
        ) : null}
      </button>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      data-floating-panel="true"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (!isMenuCommandNavigationKey(event.key)) return;
        event.preventDefault();
        moveMenuCommandFocus({
          container: menuRef.current,
          key: event.key,
          currentTarget: event.target,
        });
      }}
      style={{ position: "fixed", left, top }}
      className={cx(
        "z-canvas w-80 max-w-[calc(100vw-16px)] p-1.5",
        MENU_CHROME,
      )}
      role="menu"
      aria-label="Node actions"
    >
      {layerCandidates.length > 0 ? (
        <>
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ds-text-muted">
            Select layer
          </div>
          {item(
            "Select next overlapping element",
            Layers,
            () => {
              if (nextUnlockedLayerId) onSelectCandidate(nextUnlockedLayerId);
            },
            {
              disabled: nextUnlockedLayerId === null,
            },
          )}
          {layerCandidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 w-full items-center gap-3 rounded-ds-md px-3 py-2 text-left text-[13px] font-medium text-ds-text-primary transition-colors hover:bg-ds-state-hover"
              onClick={run(() => onSelectCandidate(candidate.id))}
            >
              <Layers size={20} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {stageNodeMenuLabel(candidate)}
              </span>
              {candidate.id === node.id ? (
                <span className="text-[11px] text-ds-text-muted">Current</span>
              ) : (
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  className="text-ds-text-muted"
                />
              )}
            </button>
          ))}
          <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
        </>
      ) : null}
      {item("Copy", Copy, onCopy, {
        disabled: selectedCount === 0,
        shortcut: "Ctrl+C",
      })}
      {item("Cut", Scissors, onCut, {
        disabled: selectedCount === 0,
        shortcut: "Ctrl+X",
      })}
      {item("Paste", ClipboardPaste, onPaste, {
        disabled: !canPaste,
        shortcut: "Ctrl+V",
      })}
      {item("Duplicate", Copy, onDuplicate, { shortcut: "Ctrl+D" })}
      {item("Delete", Trash2, onDelete, {
        disabled: selectedCount === 0,
        shortcut: "Delete",
      })}
      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
      {item(
        node.locked ? "Unlock" : "Lock",
        node.locked ? Unlock : Lock,
        onToggleLock,
      )}
      {item(
        node.hidden ? "Show" : "Hide",
        node.hidden ? Eye : EyeOff,
        onToggleHidden,
      )}
      {node.type === "connector" &&
      (node.content.from.kind === "node" || node.content.to.kind === "node") ? (
        <>
          <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
          {item("Detach start", Unlock, onDetachConnectorFrom, {
            disabled: node.content.from.kind !== "node",
          })}
          {item("Detach end", Unlock, onDetachConnectorTo, {
            disabled: node.content.to.kind !== "node",
          })}
        </>
      ) : null}
      {canGroup ? item("Group", Group, onGroup) : null}
      {canUngroup ? item("Ungroup", Ungroup, onUngroup) : null}
    </div>,
    document.body,
  );
}
