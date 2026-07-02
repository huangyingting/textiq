"use client";

/**
 * Inspector panel showing the semantic role and style binding for a selected
 * presentation node.
 *
 * Allows the user to change the `StyleRef` and variant from within the editor.
 * Purely prop-driven; no deck mutation is performed here — changes are reported
 * via `onChangeStyleBinding`.
 */

import type { JSX } from "react";

import type { SemanticRole } from "@/lib/presentation/schema";
import type { StyleRef, StyleBinding } from "@/lib/presentation/style-schema";

type StyleVariantId = string;
import { STYLE_REFS } from "@/lib/presentation/style-registry";

import { FOCUS_RING } from "@/components/ui/tokens";

// ---------------------------------------------------------------------------
// Style ref options
// ---------------------------------------------------------------------------

const STYLE_REF_OPTIONS: StyleRef[] = [...STYLE_REFS];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StyleBindingPanelProps {
  /** Current semantic role of the node (display-only). */
  role?: SemanticRole;
  /** Current style binding. */
  binding: StyleBinding | undefined;
  /** Called when the user selects a different style ref or variant. */
  onChangeStyleBinding: (binding: StyleBinding) => void;
  /** Optional list of available variants for the current ref. */
  availableVariants?: StyleVariantId[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StyleBindingPanel({
  role,
  binding,
  onChangeStyleBinding,
  availableVariants = [],
}: StyleBindingPanelProps): JSX.Element {
  const currentRef = binding?.ref ?? "";
  const currentVariant = binding?.variant ?? "default";

  function handleRefChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const ref = e.currentTarget.value as StyleRef;
    onChangeStyleBinding({ ref, variant: "default" });
  }

  function handleVariantChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!binding) return;
    const variant = e.currentTarget.value as StyleVariantId;
    onChangeStyleBinding({ ...binding, variant });
  }

  const variantOptions = [
    "default",
    ...availableVariants.filter((v) => v !== "default"),
  ];

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Style Binding
      </h4>

      {role && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-ds-text-secondary">Role</span>
          <span className="rounded bg-ds-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ds-text-primary">
            {role}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label
          htmlFor="presentation-style-ref"
          className="text-xs text-ds-text-secondary"
        >
          Style ref
        </label>
        <select
          id="presentation-style-ref"
          value={currentRef}
          onChange={handleRefChange}
          className={`w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-[13px] text-ds-text-primary outline-none ${FOCUS_RING}`}
        >
          <option value="" disabled>
            — unbound —
          </option>
          {STYLE_REF_OPTIONS.map((ref) => (
            <option key={ref} value={ref}>
              {ref}
            </option>
          ))}
        </select>
      </div>

      {currentRef && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="presentation-style-variant"
            className="text-xs text-ds-text-secondary"
          >
            Variant
          </label>
          <select
            id="presentation-style-variant"
            value={currentVariant}
            onChange={handleVariantChange}
            className={`w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-[13px] text-ds-text-primary outline-none ${FOCUS_RING}`}
          >
            {variantOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}
