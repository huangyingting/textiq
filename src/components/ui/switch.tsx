import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cx, FOCUS_RING } from "./tokens";

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "role" | "type"
> & {
  /** Whether the switch is in the on state. */
  checked: boolean;
  /** Called with the next checked value when the user activates the switch. */
  onCheckedChange: (checked: boolean) => void;
};

/**
 * An accessible toggle switch (`role="switch"` + `aria-checked`).
 *
 * Renders a styled pill track with a circular thumb.  Colors are driven by
 * `--ds-*` tokens; pass `className` to add extra styles without overriding
 * the interactive states.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, onCheckedChange, disabled, className, onClick, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        {...rest}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!disabled && !event.defaultPrevented) {
            onCheckedChange(!checked);
          }
        }}
        className={cx(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition motion-reduce:transition-none",
          checked ? "bg-ds-control" : "bg-ds-state-active",
          "disabled:pointer-events-none disabled:opacity-50",
          FOCUS_RING,
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block h-4 w-4 transform rounded-full bg-ds-control-text transition motion-reduce:transition-none",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    );
  },
);
