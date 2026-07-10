"use client";

import { useState, useTransition } from "react";

import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/locale-context";
import { isNewDocumentShortcut } from "@/lib/shortcuts/match";
import { useKeyboardShortcut } from "@/lib/shortcuts/use-keyboard-shortcuts";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

import { createDocumentFromTemplate } from "./actions";

/**
 * A modal that lists the starter templates (name + description) so the user can
 * choose how a new document begins. Blank is listed first and remains the
 * default starting point.
 *
 * Selecting a template runs `createDocumentFromTemplate` in a transition (which
 * creates the document and redirects to its editor), showing a per-tile pending
 * state. The dialog closes on Escape, a backdrop click, or the Cancel button.
 */
function TemplatePicker({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const choose = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await createDocumentFromTemplate(id);
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="template-picker-title"
      className="flex max-h-[85vh] flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="template-picker-title"
            className="text-base font-semibold text-ds-text-primary"
          >
            {t("templatePicker.title")}
          </h2>
          <p className="mt-1 text-sm text-ds-text-secondary">
            {t("templatePicker.subtitle")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("templatePicker.close")}
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {TEMPLATE_CATALOG.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              aria-label={`${template.name} template`}
              disabled={isPending}
              onClick={() => choose(template.id)}
              className="flex h-full w-full flex-col gap-1 rounded-xl border border-ds-border-strong p-4 text-left transition hover:border-ds-accent/40 hover:bg-ds-surface-sunken disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-sm font-medium text-ds-text-primary">
                {pendingId === template.id
                  ? t("templatePicker.creating")
                  : template.name}
              </span>
              <span className="text-xs text-ds-text-secondary">
                {template.description}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
        >
          {t("templatePicker.cancel")}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Opens the template picker so the user can choose how to start a new document.
 * Keeps the same props (`className`, `children`) as the previous submit button
 * so the header and empty-state call sites are unchanged.
 *
 * When `enableShortcut` is set (only the always-present header instance does so,
 * to avoid double-handling when the empty-state button is also rendered), a bare
 * `n` keypress opens the picker.
 */
export function NewDocumentButton({
  className,
  children,
  enableShortcut = false,
}: {
  className: string;
  children: React.ReactNode;
  enableShortcut?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useKeyboardShortcut(
    (event) => {
      if (isNewDocumentShortcut(event)) {
        event.preventDefault();
        setOpen(true);
      }
    },
    { enabled: enableShortcut },
  );

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <TemplatePicker onClose={() => setOpen(false)} />}
    </>
  );
}
