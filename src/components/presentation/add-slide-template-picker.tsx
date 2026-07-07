"use client";

import type { JSX } from "react";

import { cx, FOCUS_RING } from "@/components/ui/tokens";
import type { SemanticTemplateKind } from "@/lib/presentation/schema";
import type {
  SemanticTemplateV1,
  TemplateGroup,
  TemplateLayoutVariant,
} from "@/lib/presentation/template-registry";

const TEMPLATE_GROUP_ORDER: TemplateGroup[] = [
  "orient",
  "explain",
  "compare",
  "prove",
  "sequence",
  "decision",
  "commercial",
  "closing",
];

const TEMPLATE_GROUP_LABELS: Record<TemplateGroup, string> = {
  orient: "Orient",
  explain: "Explain",
  compare: "Compare",
  prove: "Prove",
  sequence: "Sequence",
  decision: "Decide",
  commercial: "Commercial",
  closing: "Close",
};

export type AddSlideTemplateChoice = {
  kind: SemanticTemplateKind;
  layoutId?: string;
};

export type AddSlideTemplatePickerProps = {
  templates: readonly SemanticTemplateV1[];
  onChoose: (choice: AddSlideTemplateChoice) => void;
  onClose: () => void;
  onEditSlideMaster?: () => void;
};

function layoutLabel(layout: TemplateLayoutVariant): string {
  const density = layout.density[0] ?? "default";
  const emphasis = layout.emphasis[0] ?? "balanced";
  return `${density} · ${emphasis}`;
}

function layoutChoiceAriaLabel(
  template: SemanticTemplateV1,
  layout: TemplateLayoutVariant,
): string {
  return `Add ${template.label} slide, ${layoutLabel(layout)}`;
}

function groupedTemplates(
  templates: readonly SemanticTemplateV1[],
): [TemplateGroup, SemanticTemplateV1[]][] {
  const byGroup = new Map<TemplateGroup, SemanticTemplateV1[]>();
  for (const template of templates) {
    const current = byGroup.get(template.group) ?? [];
    current.push(template);
    byGroup.set(template.group, current);
  }
  return TEMPLATE_GROUP_ORDER.flatMap((group) => {
    const values = byGroup
      .get(group)
      ?.slice()
      .sort((a, b) => b.selection.priority - a.selection.priority);
    return values?.length ? ([[group, values]] as const) : [];
  });
}

export function AddSlideTemplatePicker({
  templates,
  onChoose,
  onClose,
  onEditSlideMaster,
}: AddSlideTemplatePickerProps): JSX.Element {
  return (
    <section
      aria-labelledby="add-slide-template-title"
      className="flex max-h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-ds-border-subtle px-4 py-3">
        <div>
          <h2
            id="add-slide-template-title"
            className="text-sm font-semibold text-ds-text-primary"
          >
            Add semantic slide
          </h2>
          <p className="mt-1 text-xs text-ds-text-muted">
            Choose a product template and layout; content slots stay semantic.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onEditSlideMaster ? (
            <button
              type="button"
              onClick={onEditSlideMaster}
              className={cx(
                "rounded-ds-sm border border-ds-accent-border bg-ds-accent-surface px-2 py-1 text-xs font-medium text-ds-text-primary transition-colors hover:bg-ds-state-hover",
                FOCUS_RING,
              )}
            >
              Edit slide master
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className={cx(
              "rounded-ds-sm px-2 py-1 text-xs font-medium text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {groupedTemplates(templates).map(([group, groupTemplates]) => (
          <div key={group} className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ds-text-muted">
              {TEMPLATE_GROUP_LABELS[group]}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {groupTemplates.map((template) => (
                <article
                  key={template.kind}
                  className="rounded-ds-md border border-ds-border-subtle bg-ds-surface px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-ds-text-primary">
                        {template.label}
                      </h4>
                      <p className="mt-1 line-clamp-2 text-xs text-ds-text-muted">
                        {template.intent}
                      </p>
                    </div>
                    <span className="rounded-full bg-ds-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ds-text-muted">
                      {template.selection.bestFor}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {template.layouts.map((layout) => {
                      const choiceLabel = layoutLabel(layout);
                      return (
                        <button
                          key={layout.id}
                          type="button"
                          aria-label={layoutChoiceAriaLabel(template, layout)}
                          onClick={() =>
                            onChoose({
                              kind: template.kind,
                              layoutId: layout.id,
                            })
                          }
                          className={cx(
                            "rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs font-medium text-ds-text-secondary transition-colors hover:border-ds-accent-border hover:bg-ds-accent-surface hover:text-ds-text-primary",
                            FOCUS_RING,
                          )}
                        >
                          {choiceLabel}
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
