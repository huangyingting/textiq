"use client";

import { Upload, X } from "lucide-react";
import { useCallback, useRef, useState, type Ref } from "react";

import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import type { ImportActionError, ImportActionResult } from "@/lib/action-ports";
import {
  DOCUMENT_IMPORT_ACCEPT,
  DOCUMENT_IMPORT_MAX_SIZE_LABEL,
} from "@/lib/import/document-import-workflow";
import { IMPORT_MAX_UPLOAD_BYTES } from "@/lib/import/format-registry";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
} from "@/lib/telemetry/product";

type ImportButtonState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string };

function networkError(): ImportActionError {
  return {
    code: "network",
    status: 0,
    message: "Could not reach the server. Please try again.",
  };
}

function importFailureReason(error: ImportActionError): string {
  if (error.code === "network") {
    return "network";
  }
  return error.code || "unknown";
}

/**
 * The editor-toolbar file picker that imports a document into Markdown through
 * an injected server-owned parse port.
 */
export function ImportButton({
  onImport,
  importFile,
  label = "Import document",
  iconOnly = false,
  buttonRef,
}: {
  onImport: (markdown: string) => void;
  importFile: (file: File) => Promise<ImportActionResult<{ markdown: string }>>;
  label?: string;
  iconOnly?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const [state, setState] = useState<ImportButtonState>({ status: "idle" });
  const isUploading = state.status === "uploading";
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);

  const processFile = useCallback(
    async (file: File) => {
      if (isUploadingRef.current) {
        return;
      }

      const fileType = classifyFileType(file);
      const fileSizeBucket = bucketBytes(file.size);
      if (file.size > IMPORT_MAX_UPLOAD_BYTES) {
        emitProductTelemetry("product.import.failed", {
          failureReason: "too_large",
          fileSizeBucket,
          fileType,
          surface: "toolbar",
        });
        setState({
          status: "error",
          message: `File is too large. Maximum allowed size is ${DOCUMENT_IMPORT_MAX_SIZE_LABEL}.`,
        });
        return;
      }

      isUploadingRef.current = true;
      setState({ status: "uploading" });
      const startedAt = performance.now();
      emitProductTelemetry("product.import.started", {
        fileSizeBucket,
        fileType,
        surface: "toolbar",
      });

      let result: ImportActionResult<{ markdown: string }>;
      try {
        result = await importFile(file);
      } catch {
        result = { ok: false, error: networkError() };
      }

      if (result.ok) {
        emitProductTelemetry("product.import.succeeded", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          fileSizeBucket,
          fileType,
          surface: "toolbar",
        });
        isUploadingRef.current = false;
        setState({ status: "idle" });
        onImport(result.data.markdown);
        return;
      }

      emitProductTelemetry("product.import.failed", {
        durationBucket: bucketDurationMs(performance.now() - startedAt),
        failureReason: importFailureReason(result.error),
        fileSizeBucket,
        fileType,
        status: result.error.status,
        surface: "toolbar",
      });
      isUploadingRef.current = false;
      setState({ status: "error", message: result.error.message });
    },
    [importFile, onImport],
  );

  const dismissError = () => setState({ status: "idle" });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_IMPORT_ACCEPT}
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Import document file"
      />

      {state.status === "error" ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[var(--ds-radius-md,10px)] border border-ds-danger-border bg-ds-danger-surface px-3 py-2 text-xs text-ds-danger-text"
        >
          <span className="flex-1">{state.message}</span>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => inputRef.current?.click()}
            className="tiq-touch-target shrink-0 rounded-full border border-ds-danger-border px-2 py-1 font-medium hover:bg-ds-state-hover"
          >
            Try again
          </button>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={dismissError}
            className="tiq-touch-target shrink-0 rounded-full p-0.5 hover:bg-ds-state-hover"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <EditorToolbarButton
          ref={buttonRef}
          label={isUploading ? "Importing…" : label}
          tooltip={label}
          icon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          iconOnly={iconOnly}
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          aria-label={label}
        />
      )}
    </>
  );
}
