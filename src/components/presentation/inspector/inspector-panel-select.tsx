"use client";

import { FOCUS_RING, cx } from "@/components/ui/tokens";
import type {
  InspectorPanelId,
  InspectorPanelOption,
} from "@/lib/presentation/inspector-panel-ui";

export interface InspectorPanelSelectProps {
  id: string;
  panels: readonly InspectorPanelOption[];
  value: InspectorPanelId;
  diagnosticsCount: number;
  onChange: (panel: InspectorPanelId) => void;
}

function optionLabel(
  panel: InspectorPanelOption,
  diagnosticsCount: number,
): string {
  if (panel.id === "diagnostics" && diagnosticsCount > 0) {
    return `${panel.label} (${diagnosticsCount})`;
  }
  return panel.label;
}

export function InspectorPanelSelect({
  id,
  panels,
  value,
  diagnosticsCount,
  onChange,
}: InspectorPanelSelectProps) {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-ds-text-muted">
      <span className="sr-only">Inspector panel</span>
      <select
        id={id}
        aria-label="Inspector panel"
        value={value}
        onChange={(event) =>
          onChange(event.currentTarget.value as InspectorPanelId)
        }
        className={cx(
          "h-7 max-w-36 rounded-[var(--ds-radius-sm,6px)] border border-ds-border-subtle bg-ds-surface px-2 text-xs font-medium text-ds-text-primary outline-none",
          FOCUS_RING,
        )}
      >
        {panels.map((panel) => (
          <option key={panel.id} value={panel.id}>
            {optionLabel(panel, diagnosticsCount)}
          </option>
        ))}
      </select>
    </label>
  );
}
