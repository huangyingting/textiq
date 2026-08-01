import { type HTMLAttributes } from "react";

import { cx } from "./tokens";

/** A single pulsing rectangular placeholder driven by DS surface tokens. */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "animate-pulse rounded-[var(--ds-radius-sm,8px)] bg-[var(--ds-surface-raised,#f3f4f6)] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export type LoadingRegionProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "role" | "aria-busy" | "aria-label"
> & {
  /** Screen-reader announcement. Defaults to "Loading…". */
  label?: string;
};

/**
 * Wrapper that marks a region as loading for assistive technology.
 * Renders `role="status"` + `aria-busy="true"` plus a visually-hidden
 * announcement so screen-reader users hear feedback without seeing jank.
 */
export function LoadingRegion({
  label = "Loading…",
  children,
  className,
  ...props
}: LoadingRegionProps) {
  return (
    <div
      {...props}
      role="status"
      aria-busy="true"
      aria-label={label}
      className={className}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
