"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { FOCUS_RING } from "@/components/ui/tokens";
import { Tooltip, cx } from "@/components/ui";

export function EditorToolbarGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 shrink-0 items-center gap-1"
    >
      {children}
    </div>
  );
}

export function EditorToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="hidden h-7 w-px shrink-0 bg-ds-border-subtle md:block"
    />
  );
}

function editorToolbarButtonClass({
  active = false,
  iconOnly = false,
  className,
}: {
  active?: boolean;
  iconOnly?: boolean;
  className?: string;
} = {}) {
  return cx(
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-ds-md text-sm font-medium text-ds-text-primary transition-colors hover:bg-ds-state-hover active:bg-ds-state-active disabled:cursor-not-allowed disabled:opacity-50",
    iconOnly
      ? "w-8 px-0"
      : "w-8 px-0 [[data-toolbar-labels='show']_&]:w-auto [[data-toolbar-labels='show']_&]:px-3",
    active && "bg-ds-accent-surface text-ds-accent-text",
    FOCUS_RING,
    className,
  );
}

export type EditorToolbarButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> & {
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  active?: boolean;
  tooltip?: ReactNode;
  tooltipSide?: "top" | "bottom";
};

export const EditorToolbarButton = forwardRef<
  HTMLButtonElement,
  EditorToolbarButtonProps
>(function EditorToolbarButton(
  {
    label,
    icon,
    iconOnly = false,
    active = false,
    tooltip = label,
    tooltipSide = "bottom",
    className,
    children,
    type,
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={ariaLabel ?? label}
      className={editorToolbarButtonClass({ active, iconOnly, className })}
      {...props}
    >
      {children ?? (
        <>
          {icon}
          <span
            className={
              iconOnly
                ? "sr-only"
                : "hidden [[data-toolbar-labels='show']_&]:inline"
            }
          >
            {label}
          </span>
        </>
      )}
    </button>
  );

  return (
    <Tooltip label={tooltip} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
