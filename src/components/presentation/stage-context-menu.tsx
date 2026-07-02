"use client";

import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  Edit3,
  Group,
  Layers,
  Lock,
  Scissors,
  SendToBack,
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
import { cx, MENU_CHROME, MENU_ITEM } from "@/components/ui/tokens";

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
  onEdit,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onBringToFront,
  onSendToBack,
  onToggleLock,
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
  onEdit: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onToggleLock: () => void;
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

  const menuWidth = 224;
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 320));
  const layerCandidates = candidates.length > 1 ? candidates : [];
  const editable =
    node.type === "text" || node.type === "shape" || node.type === "table";
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const item = (
    label: string,
    icon: LucideIcon,
    onSelect: () => void,
    options: { disabled?: boolean } = {},
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={options.disabled}
        className={cx(MENU_ITEM, options.disabled ? "opacity-40" : undefined)}
        onClick={run(onSelect)}
      >
        <Icon size={14} aria-hidden="true" className="mr-2 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
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
      className={cx("z-dropdown w-56 p-1", MENU_CHROME)}
      role="menu"
      aria-label="Node actions"
    >
      {layerCandidates.length > 0 ? (
        <>
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
            Select layer
          </div>
          {layerCandidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={MENU_ITEM}
              onClick={run(() => onSelectCandidate(candidate.id))}
            >
              <Layers size={14} aria-hidden="true" className="mr-2 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {stageNodeMenuLabel(candidate)}
              </span>
              {candidate.id === node.id ? (
                <span className="ml-2 text-[10px] text-ds-text-muted">
                  Current
                </span>
              ) : null}
            </button>
          ))}
          <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
        </>
      ) : null}
      {editable
        ? item(
            node.type === "table" ? "Edit table" : "Edit text",
            Edit3,
            onEdit,
          )
        : null}
      {item("Duplicate", Copy, onDuplicate)}
      {item("Copy", Copy, onCopy, { disabled: selectedCount === 0 })}
      {item("Cut", Scissors, onCut, { disabled: selectedCount === 0 })}
      {item("Paste", ClipboardPaste, onPaste, { disabled: !canPaste })}
      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
      {item("Bring to front", BringToFront, onBringToFront)}
      {item("Send to back", SendToBack, onSendToBack)}
      {item(
        node.locked ? "Unlock" : "Lock",
        node.locked ? Unlock : Lock,
        onToggleLock,
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
      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
      {item("Delete", Trash2, onDelete, { disabled: selectedCount === 0 })}
    </div>,
    document.body,
  );
}
