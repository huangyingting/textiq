"use client";

import { useRef, useState } from "react";

import { TemplatePickerDialog } from "@/components/template-picker-dialog";
import { isNewDocumentShortcut } from "@/lib/shortcuts/match";
import { useKeyboardShortcut } from "@/lib/shortcuts/use-keyboard-shortcuts";

import { createDocumentFromTemplate } from "./actions";

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
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <TemplatePickerDialog
          onChoose={createDocumentFromTemplate}
          onClose={() => setOpen(false)}
          restoreFocusRef={triggerRef}
        />
      )}
    </>
  );
}
