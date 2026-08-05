"use client";

import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
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
  const options: SelectMenuOption[] = panels.map((panel) => ({
    value: panel.id,
    label: optionLabel(panel, diagnosticsCount),
  }));
  return (
    <div
      id={id}
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-ds-text-muted"
    >
      <span className="sr-only">Inspector panel</span>
      <SelectMenu
        aria-label="Inspector panel"
        variant="field"
        value={value}
        options={options}
        onChange={(next) => onChange(next as InspectorPanelId)}
        buttonClassName="h-7 max-w-36"
      />
    </div>
  );
}
