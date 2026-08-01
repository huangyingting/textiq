"use client";

import {
  BringToFront,
  FileText,
  Image as ImageIcon,
  SendToBack,
  Spline,
  Square,
  Table2,
  Type as TypeIcon,
} from "lucide-react";
import type { RefObject, ReactNode } from "react";

import { ColorPicker } from "@/components/ui/color-picker";
import { Tooltip } from "@/components/ui/tooltip";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import type {
  CurrentObjectInsertNodeKind,
  CurrentObjectReorderMode,
} from "@/lib/presentation/current-object-command-descriptors";

export function renderContextToolbarInsertIcon(
  key: CurrentObjectInsertNodeKind,
) {
  switch (key) {
    case "text":
      return <TypeIcon size={13} aria-hidden />;
    case "shape":
      return <Square size={13} aria-hidden />;
    case "image":
      return <ImageIcon size={13} aria-hidden />;
    case "visual":
      return <FileText size={13} aria-hidden />;
    case "connector":
      return <Spline size={13} aria-hidden />;
    case "table":
      return <Table2 size={13} aria-hidden />;
  }
}

export function renderContextToolbarLayerIcon(key: CurrentObjectReorderMode) {
  switch (key) {
    case "forward":
      return <BringToFront size={13} aria-hidden />;
    case "backward":
      return <SendToBack size={13} aria-hidden />;
    case "front":
      return "TF";
    case "back":
      return "TB";
  }
}

interface ContextToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  hasPopup?: "menu" | "dialog";
  expanded?: boolean;
  controls?: string;
}

export function ContextToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
  buttonRef,
  hasPopup,
  expanded,
  controls,
}: ContextToolbarButtonProps) {
  return (
    <Tooltip label={label} delay={250}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={active}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup ? expanded : undefined}
        aria-controls={controls}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "flex h-7 w-7 items-center justify-center rounded-ds-md text-ds-text-muted transition-colors",
          "hover:bg-ds-state-hover hover:text-ds-text-primary",
          "disabled:pointer-events-none disabled:opacity-40",
          active ? "bg-ds-accent-surface text-ds-accent-text" : undefined,
          FOCUS_RING,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function ContextToolbarDivider() {
  return <div aria-hidden className="mx-1 h-5 w-px bg-ds-border-subtle" />;
}

export function ContextToolbarColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ColorPicker
      color={value}
      onChange={onChange}
      aria-label={label}
      size="sm"
      triggerChrome="swatch"
      layer="tooltip"
      preserveSelection
    />
  );
}

export function ContextToolbarSelect({
  label,
  value,
  onChange,
  children,
  width = "w-20",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  width?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-ds-text-muted">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        title={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cx(
          "h-7 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none",
          width,
          FOCUS_RING,
        )}
      >
        {children}
      </select>
    </label>
  );
}

export function ContextToolbarNumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  inlineCommandSurface = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  inlineCommandSurface?: boolean;
}) {
  const normalizedValue = Number.isFinite(value) ? value : 0;
  return (
    <input
      type="number"
      aria-label={label}
      title={label}
      value={inlineCommandSurface ? undefined : normalizedValue}
      defaultValue={inlineCommandSurface ? normalizedValue : undefined}
      min={min}
      max={max}
      step={step}
      data-inline-text-command-surface={
        inlineCommandSurface ? "true" : undefined
      }
      onMouseDown={
        inlineCommandSurface
          ? (event) => {
              event.stopPropagation();
            }
          : undefined
      }
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        onChange(Number(nextValue));
      }}
      className={cx(
        "h-7 w-14 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none",
        FOCUS_RING,
      )}
    />
  );
}
