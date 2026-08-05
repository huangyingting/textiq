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

import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";

// ---------------------------------------------------------------------------
// Style ref options
// ---------------------------------------------------------------------------

const STYLE_REF_OPTIONS: StyleRef[] = [...STYLE_REFS];

const STYLE_REF_SELECT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "", label: "— unbound —", disabled: true },
  ...STYLE_REF_OPTIONS.map((ref) => ({ value: ref, label: ref })),
];

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

  function handleRefChange(next: string) {
    const ref = next as StyleRef;
    onChangeStyleBinding({ ref, variant: "default" });
  }

  function handleVariantChange(next: string) {
    if (!binding) return;
    const variant = next as StyleVariantId;
    onChangeStyleBinding({ ...binding, variant });
  }

  const variantOptions = [
    "default",
    ...availableVariants.filter((v) => v !== "default"),
  ];

  const variantSelectOptions: SelectMenuOption[] = variantOptions.map((v) => ({
    value: v,
    label: v,
  }));

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
        <SelectMenu
          aria-label="Style ref"
          variant="field"
          value={currentRef}
          options={STYLE_REF_SELECT_OPTIONS}
          onChange={handleRefChange}
        />
      </div>

      {currentRef && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="presentation-style-variant"
            className="text-xs text-ds-text-secondary"
          >
            Variant
          </label>
          <SelectMenu
            aria-label="Variant"
            variant="field"
            value={currentVariant}
            options={variantSelectOptions}
            onChange={handleVariantChange}
          />
        </div>
      )}
    </section>
  );
}
