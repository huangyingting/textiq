"use client";

import { useMemo } from "react";
import { X } from "lucide-react";

import { IconButton } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { canvasShortcutHelp } from "@/lib/presentation/canvas-shortcut-help";

/**
 * In-product keyboard shortcut help overlay for the slide editor canvas (#535).
 * Built on the shared accessible {@link Dialog} (focus-trapped, Escape to
 * close, focus restored on close); the shortcut content comes from the pure
 * {@link canvasShortcutHelp} helper so it stays in sync with the keyboard
 * model and is unit-tested.
 */
export function KeyboardShortcutHelpDialog({
  open,
  isMac,
  onClose,
}: {
  open: boolean;
  isMac: boolean;
  onClose: () => void;
}) {
  const groups = useMemo(() => canvasShortcutHelp({ isMac }), [isMac]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="canvas-keyboard-help-title"
      className="max-w-2xl"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2
          id="canvas-keyboard-help-title"
          className="text-base font-semibold text-ds-text-primary"
        >
          Keyboard shortcuts
        </h2>
        <IconButton
          aria-label="Close"
          size="sm"
          variant="plain"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
              {group.title}
            </h3>
            <dl className="flex flex-col gap-1.5">
              {group.entries.map((entry) => (
                <div
                  key={entry.keys}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <dt className="text-ds-text-secondary">
                    {entry.description}
                  </dt>
                  <dd className="shrink-0">
                    <kbd className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised px-1.5 py-0.5 text-xs font-medium text-ds-text-primary">
                      {entry.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
