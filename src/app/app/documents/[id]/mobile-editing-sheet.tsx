"use client";

import { PanelRight, X } from "lucide-react";
import { useState } from "react";

import { BottomSheetSurface, Surface, cx } from "@/components/ui";

import { GenerateVisualSection } from "./mobile-generate-visual-section";
import { TextFormatSection } from "./mobile-text-format-section";
import { TableEditingSection } from "./table-controls";
import { VisualContextSection } from "./mobile-visual-context-section";
import { useEditingSurface } from "./use-editing-surface";

/**
 * Renders a floating action button for coarse-pointer viewports that opens a
 * bottom sheet containing contextual text/visual editing sections.
 */
function MobileEditingSheet() {
  const surface = useEditingSurface();
  const [open, setOpen] = useState(false);

  const { group } = surface;

  if (surface.mode !== "sheet") return null;

  const fabLabel =
    group === "text-format"
      ? "Open text formatting"
      : group === "table-edit"
        ? "Open table editing"
        : "Open visual editing";
  const panelTitle =
    group === "text-format"
      ? "Text format"
      : group === "table-edit"
        ? "Table"
        : "Visual";

  return (
    <>
      <button
        type="button"
        aria-label={fabLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cx(
          "tiq-safe-fab fixed z-dropdown",
          "flex h-12 w-12 items-center justify-center rounded-full",
          "bg-[var(--ds-accent,#6366f1)] text-[var(--ds-text-on-accent,#ffffff)]",
          "shadow-[var(--ds-shadow-overlay,0_8px_24px_rgba(0,0,0,0.18))]",
          "transition hover:bg-[var(--ds-accent-hover,#4f46e5)] active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-focus-ring,#6366f1)] focus-visible:ring-offset-2",
        )}
      >
        <PanelRight aria-hidden="true" className="h-5 w-5" />
      </button>

      <BottomSheetSurface
        open={open}
        onClose={() => setOpen(false)}
        aria-label="Editing panel"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-ds-pill bg-ds-border-subtle"
          />
          <p className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
            {panelTitle}
          </p>
          <button
            type="button"
            aria-label="Close editing panel"
            onClick={() => setOpen(false)}
            className="tiq-touch-target flex h-7 w-7 items-center justify-center rounded-ds-pill text-ds-text-muted transition hover:bg-ds-state-hover"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto pb-3">
          {group === "text-format" && (
            <Surface elevation="flat" radius="sm" bordered={false}>
              <GenerateVisualSection />
              <TextFormatSection />
            </Surface>
          )}
          {group === "visual-edit" && (
            <Surface elevation="flat" radius="sm" bordered={false}>
              <VisualContextSection />
            </Surface>
          )}
          {group === "table-edit" && (
            <Surface elevation="flat" radius="sm" bordered={false}>
              <TableEditingSection />
            </Surface>
          )}
        </div>
      </BottomSheetSurface>
    </>
  );
}

export function MobileEditingSheetHost({
  editable = true,
}: {
  editable?: boolean;
}) {
  if (!editable) {
    return null;
  }

  return <MobileEditingSheet />;
}
