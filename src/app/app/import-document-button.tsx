"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/locale-context";
import {
  DOCUMENT_IMPORT_ACCEPT,
  useDocumentImportCreationWorkflow,
} from "@/lib/import/document-import-workflow";

/**
 * Dashboard button that lets users create a new document from an imported
 * file. Uploads the file to `POST /api/import` in durable create mode and
 * only navigates once persistence succeeds.
 *
 * The button is styled to match the existing `primaryButtonClass` from the
 * dashboard header so it sits alongside "New document".
 */
export function ImportDocumentButton({ className }: { className: string }) {
  const t = useTranslation();
  const router = useRouter();
  const { inputRef, state, isUploading, processFile, clearError } =
    useDocumentImportCreationWorkflow({
      surface: "dashboard",
      target: { kind: "personal" },
      onCreated: ({ documentPath }) => {
        router.push(documentPath);
      },
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_IMPORT_ACCEPT}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processFile(file);
          e.target.value = "";
        }}
        className="sr-only"
        aria-label="Import a document file"
      />
      <button
        type="button"
        disabled={isUploading}
        onClick={() => {
          clearError();
          inputRef.current?.click();
        }}
        className={`${className} tiq-touch-target`}
        aria-label="Import document"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {isUploading
          ? t("dashboard.action.importing")
          : t("dashboard.action.import")}
      </button>
      {state.status === "error" && (
        <p
          role="alert"
          className="max-w-xs text-right text-xs text-ds-danger-text"
        >
          {state.message} —{" "}
          <button
            type="button"
            onClick={() => {
              clearError();
              inputRef.current?.click();
            }}
            className="tiq-touch-target inline-flex items-center underline"
          >
            retry
          </button>
        </p>
      )}
    </div>
  );
}
