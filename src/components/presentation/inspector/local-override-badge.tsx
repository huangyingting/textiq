"use client";

/**
 * Badge indicating that a node has local style overrides above the theme
 * style, plus an inline action to reset them to the theme default.
 *
 * The inspector calls `resetLocalStyleOverride` from the editor-commands
 * module; this component only surfaces the affordance and reports intent via
 * `onResetToTheme`.
 */

import type { JSX } from "react";

import type { StylePatch } from "@/lib/presentation/style-schema";
import { FOCUS_RING } from "@/components/ui/tokens";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LocalOverrideBadgeProps {
  /** The node's current `localStyle` (from the Deck schema node). */
  localStyle: StylePatch | undefined;
  /** Called when the user confirms they want to reset overrides. */
  onResetToTheme: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOverrideKeys(localStyle: StylePatch | undefined): number {
  if (!localStyle) return 0;
  return Object.keys(localStyle).filter(
    (k) => (localStyle as Record<string, unknown>)[k] !== undefined,
  ).length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders nothing when there are no local overrides.
 * Renders a yellow badge + reset button when overrides are present.
 */
export function LocalOverrideBadge({
  localStyle,
  onResetToTheme,
}: LocalOverrideBadgeProps): JSX.Element | null {
  const count = countOverrideKeys(localStyle);
  if (count === 0) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-subtle px-3 py-2">
      <span className="text-xs font-medium text-ds-status-warning-text">
        {count === 1 ? "1 local override" : `${count} local overrides`}
      </span>
      <button
        type="button"
        onClick={onResetToTheme}
        className={`shrink-0 rounded-ds-sm px-2 py-0.5 text-[11px] font-medium text-ds-status-warning-text underline-offset-2 hover:underline ${FOCUS_RING}`}
      >
        Reset to theme
      </button>
    </div>
  );
}
