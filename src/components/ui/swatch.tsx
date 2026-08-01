import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cx, FOCUS_RING, RADIUS } from "./tokens";

export type SwatchSize = "sm" | "md" | "lg";

/** Size → square dimensions. `sm` = 20px, `md` = 24px, `lg` = 28px. */
const SIZE: Record<SwatchSize, string> = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-7 w-7",
};

export type SwatchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color"
> & {
  /** CSS color shown as the swatch fill. */
  color: string;
  /** Required: swatches have no visible text, so they must be labelled. */
  "aria-label": string;
  /** Renders a selected ring + checkmark and reflects `aria-pressed`. */
  selected?: boolean;
  size?: SwatchSize;
};

/**
 * An on-brand color swatch button: a rounded tile filled with `color`, a subtle
 * `--ds-border-subtle` outline so light fills stay visible, a token-driven focus ring,
 * and a selected state (accent ring + checkmark). Replaces the raw
 * `<input type=color>` chips in the visual style controls — it is the trigger a
 * {@link ColorPicker} opens from, and the chip a theme grid is built out of.
 */
export const Swatch = forwardRef<HTMLButtonElement, SwatchProps>(
  function Swatch(
    {
      color,
      selected,
      size = "md",
      type,
      className,
      children,
      "aria-pressed": ariaPressed,
      style,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-pressed={selected ?? ariaPressed}
        className={cx(
          "relative inline-flex shrink-0 select-none items-center justify-center border transition-shadow",
          SIZE[size],
          RADIUS.md,
          selected
            ? "border-transparent ring-2 ring-[var(--ds-accent,#6366f1)] ring-offset-1 ring-offset-[var(--ds-focus-offset,#ffffff)]"
            : "border-[var(--ds-border-subtle,rgba(0,0,0,0.12))] hover:ring-2 hover:ring-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
          FOCUS_RING,
          className,
        )}
        style={{ ...style, backgroundColor: color }}
        {...rest}
      >
        {selected ? (
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 8.5l3 3 6-6.5" />
          </svg>
        ) : null}
        {children}
      </button>
    );
  },
);
