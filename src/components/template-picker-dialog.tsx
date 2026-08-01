"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";

import { Button, Dialog, IconButton, PANEL_CHROME, cx } from "@/components/ui";
import { useTranslation } from "@/lib/i18n/locale-context";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

type TemplatePickerDialogProps = {
  onChoose: (templateId: string) => Promise<void>;
  onClose: () => void;
  restoreFocusRef: RefObject<HTMLElement | null>;
};

/**
 * Shared starter-template picker for personal and workspace document creation.
 *
 * Creation failures stay inside the dialog so the surrounding route remains
 * usable. Next control-flow errors (redirect/not-found) are rethrown before the
 * generic recovery UI is shown. A synchronous ref closes the same-event window
 * before React has committed the disabled state, preventing duplicate durable
 * creates from rapid or scripted activation.
 */
export function TemplatePickerDialog({
  onChoose,
  onClose,
  restoreFocusRef,
}: TemplatePickerDialogProps) {
  const t = useTranslation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const operationIdRef = useRef(0);
  const isCreatingRef = useRef(false);
  const isCreating = pendingId !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationIdRef.current += 1;
      isCreatingRef.current = false;
    };
  }, []);

  const requestClose = () => {
    if (!isCreatingRef.current) onClose();
  };

  const choose = (id: string) => {
    if (isCreatingRef.current) return;

    isCreatingRef.current = true;
    const operationId = ++operationIdRef.current;
    setPendingId(id);
    setFailedId(null);
    setError(null);
    return (async () => {
      try {
        await onChoose(id);
      } catch (creationError) {
        unstable_rethrow(creationError);
        if (!mountedRef.current || operationIdRef.current !== operationId) {
          return;
        }
        setFailedId(id);
        setError(t("templatePicker.creationError"));
      } finally {
        if (mountedRef.current && operationIdRef.current === operationId) {
          isCreatingRef.current = false;
          setPendingId(null);
        }
      }
    })();
  };

  return (
    <Dialog
      open
      onClose={requestClose}
      restoreFocusRef={restoreFocusRef}
      aria-labelledby="template-picker-title"
      aria-busy={isCreating}
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
        <IconButton
          aria-label={t("templatePicker.close")}
          disabled={isCreating}
          onClick={requestClose}
          size="md"
          className="shrink-0"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </IconButton>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {TEMPLATE_CATALOG.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              aria-label={`${template.name} template`}
              disabled={isCreating}
              onClick={() => choose(template.id)}
              className={cx(
                "flex h-full w-full flex-col gap-1 p-4 text-left transition hover:border-ds-accent-border hover:bg-ds-surface-sunken disabled:cursor-not-allowed disabled:opacity-60",
                PANEL_CHROME,
              )}
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

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
        >
          <p>{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => (failedId ? choose(failedId) : undefined)}
            >
              {t("templatePicker.tryAgain")}
            </Button>
            <Button
              variant="plain"
              size="sm"
              onClick={() => {
                setError(null);
                setFailedId(null);
              }}
            >
              {t("templatePicker.dismissError")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end">
        <Button
          variant="subtle"
          size="lg"
          disabled={isCreating}
          onClick={requestClose}
        >
          {t("templatePicker.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}
