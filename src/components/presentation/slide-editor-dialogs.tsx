import { useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { Edit3, X } from "lucide-react";

import type {
  DiagnosticAction,
  PresentationDiagnostic,
} from "@/lib/presentation/diagnostics";
import type { InspectorPanelId } from "@/lib/presentation/inspector-panel-ui";
import type { SlideNode } from "@/lib/presentation/schema";
import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

import {
  AddSlideTemplatePicker,
  type AddSlideTemplateChoice,
} from "./add-slide-template-picker";
import { DeckDiagnosticsReview } from "./deck-diagnostics-review";
import type { MobileInspectorContext } from "./mobile-inspector-context";

export function FocusTrapped({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref);
  return <div ref={ref}>{children}</div>;
}

interface SlideEditorInspectorRegionProps {
  isDesktopInspectorViewport: boolean;
  activeSlide: SlideNode | undefined;
  inspectorSheetOpen: boolean;
  onOpenMobileInspector: () => void;
  onCloseMobileInspector: () => void;
  renderInspectorShell: () => JSX.Element;
  mobileInspectorContext?: MobileInspectorContext & {
    onSelectPanel: (panel: InspectorPanelId) => void;
  };
}

export function SlideEditorInspectorRegion({
  isDesktopInspectorViewport,
  activeSlide,
  inspectorSheetOpen,
  onOpenMobileInspector,
  onCloseMobileInspector,
  renderInspectorShell,
  mobileInspectorContext,
}: SlideEditorInspectorRegionProps): JSX.Element {
  const showMobileInspector =
    !isDesktopInspectorViewport && Boolean(activeSlide);
  const inspectorContext: MobileInspectorContext & {
    onSelectPanel: (panel: InspectorPanelId) => void;
  } = mobileInspectorContext ?? {
    targetLabel: "Slide",
    actionLabel: "Edit slide",
    dialogLabel: "Slide inspector",
    activePanel: "slide" as InspectorPanelId,
    activePanelLabel: "Slide",
    panels: [],
    onSelectPanel: (_panel: InspectorPanelId) => undefined,
  };

  return (
    <>
      {isDesktopInspectorViewport ? (
        <div className="absolute bottom-4 right-4 top-4 z-panel hidden w-80 overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay shadow-ds-overlay lg:flex">
          {renderInspectorShell()}
        </div>
      ) : null}

      {showMobileInspector ? (
        <div className="lg:hidden">
          <button
            type="button"
            data-floating-panel="true"
            aria-label={inspectorContext.actionLabel}
            aria-haspopup="dialog"
            aria-expanded={inspectorSheetOpen}
            onClick={onOpenMobileInspector}
            className={cx(
              "tiq-safe-fab fixed z-modal flex min-h-12 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-ds-accent px-3 py-2 text-ds-text-on-accent shadow-ds-overlay transition-colors hover:bg-ds-accent-hover",
              FOCUS_RING,
            )}
          >
            <Edit3 aria-hidden="true" className="h-5 w-5" />
            <span className="min-w-0 text-left leading-none">
              <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-80">
                Edit
              </span>
              <span className="block max-w-28 truncate text-xs font-semibold">
                {inspectorContext.targetLabel}
              </span>
            </span>
          </button>

          {inspectorSheetOpen ? (
            <>
              <div
                data-floating-panel="true"
                aria-hidden="true"
                onClick={onCloseMobileInspector}
                className="fixed inset-0 z-modal bg-ds-backdrop"
              />
              <FocusTrapped>
                <div
                  data-floating-panel="true"
                  role="dialog"
                  aria-modal="true"
                  aria-label={inspectorContext.dialogLabel}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      onCloseMobileInspector();
                    }
                  }}
                  className="tiq-mobile-sheet fixed inset-x-0 bottom-0 z-modal flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t border-ds-border-subtle bg-ds-surface-base shadow-ds-popover"
                >
                  <div className="relative flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-4">
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-ds-border-subtle"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
                        {inspectorContext.dialogLabel}
                      </p>
                      <p className="truncate text-[11px] text-ds-text-muted">
                        {inspectorContext.activePanelLabel} panel
                      </p>
                      {inspectorContext.panels.length > 1 ? (
                        <div
                          aria-label="Inspector panels"
                          className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1"
                        >
                          {inspectorContext.panels.map((panel) => {
                            const selected =
                              panel.id === inspectorContext.activePanel;
                            return (
                              <button
                                key={panel.id}
                                type="button"
                                aria-label={`Show ${panel.label} inspector panel`}
                                aria-pressed={selected}
                                onClick={() =>
                                  inspectorContext.onSelectPanel(panel.id)
                                }
                                className={cx(
                                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                                  selected
                                    ? "bg-ds-accent-surface text-ds-accent-text"
                                    : "bg-ds-surface-subtle text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
                                  FOCUS_RING,
                                )}
                              >
                                {panel.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <span className="sr-only" aria-live="polite">
                        {inspectorContext.activePanelLabel} panel selected
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Close ${inspectorContext.dialogLabel.toLowerCase()}`}
                      onClick={onCloseMobileInspector}
                      className={cx(
                        "tiq-touch-target flex h-7 w-7 items-center justify-center rounded-full text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {renderInspectorShell()}
                  </div>
                </div>
              </FocusTrapped>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface SlideEditorAddSlideDialogProps {
  templates: Parameters<typeof AddSlideTemplatePicker>[0]["templates"];
  onChoose: (choice: AddSlideTemplateChoice) => void;
  onClose: () => void;
  onAuthorBrandKit?: () => void;
}

export function SlideEditorAddSlideDialog({
  templates,
  onChoose,
  onClose,
  onAuthorBrandKit,
}: SlideEditorAddSlideDialogProps): JSX.Element {
  return (
    <>
      <div
        data-floating-panel="true"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-modal bg-ds-backdrop"
      />
      <FocusTrapped>
        <div
          data-floating-panel="true"
          role="dialog"
          aria-modal="true"
          aria-label="Add semantic slide"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
          className="fixed inset-x-4 top-8 z-modal mx-auto flex max-h-[calc(100vh-4rem)] max-w-5xl overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay shadow-ds-overlay"
        >
          <AddSlideTemplatePicker
            templates={templates}
            onChoose={onChoose}
            onClose={onClose}
            onAuthorBrandKit={onAuthorBrandKit}
          />
        </div>
      </FocusTrapped>
    </>
  );
}

interface SlideEditorDiagnosticsReviewDialogProps {
  diagnostics: readonly PresentationDiagnostic[];
  onClose: () => void;
  onNavigate: (diagnostic: PresentationDiagnostic) => void;
  onAction: (
    action: DiagnosticAction,
    diagnostic: PresentationDiagnostic,
  ) => void;
}

export function SlideEditorDiagnosticsReviewDialog({
  diagnostics,
  onClose,
  onNavigate,
  onAction,
}: SlideEditorDiagnosticsReviewDialogProps): JSX.Element {
  return (
    <FocusTrapped>
      <DeckDiagnosticsReview
        diagnostics={diagnostics}
        onClose={onClose}
        onNavigate={onNavigate}
        onAction={onAction}
      />
    </FocusTrapped>
  );
}
