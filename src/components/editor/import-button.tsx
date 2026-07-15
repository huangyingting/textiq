"use client";

import { Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import type { ImportActionError, ImportActionResult } from "@/lib/action-ports";
import {
  DOCUMENT_IMPORT_ACCEPT,
  DOCUMENT_IMPORT_ACCEPT_LABEL,
  DOCUMENT_IMPORT_MAX_SIZE_LABEL,
} from "@/lib/import/document-import-workflow";
import { IMPORT_MAX_UPLOAD_BYTES } from "@/lib/import/format-registry";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
} from "@/lib/telemetry/product";

type ImportSurface = "toolbar" | "dropzone";

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
 * A drag-and-drop + file-picker button that imports a document into Markdown
 * through an injected server-owned parse port.
 */
export function ImportButton({
  onImport,
  importFile,
  label = "Import document",
  compact = false,
  iconOnly = false,
}: {
  onImport: (markdown: string) => void;
  importFile: (file: File) => Promise<ImportActionResult<{ markdown: string }>>;
  label?: string;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<ImportButtonState>({ status: "idle" });
  const isUploading = state.status === "uploading";
  const surface: ImportSurface = compact ? "toolbar" : "dropzone";
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const fileType = classifyFileType(file);
      const fileSizeBucket = bucketBytes(file.size);
      if (file.size > IMPORT_MAX_UPLOAD_BYTES) {
        emitProductTelemetry("product.import.failed", {
          failureReason: "too_large",
          fileSizeBucket,
          fileType,
          surface,
        });
        setState({
          status: "error",
          message: `File is too large. Maximum allowed size is ${DOCUMENT_IMPORT_MAX_SIZE_LABEL}.`,
        });
        return;
      }

      setState({ status: "uploading" });
      const startedAt = performance.now();
      emitProductTelemetry("product.import.started", {
        fileSizeBucket,
        fileType,
        surface,
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
          surface,
        });
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
        surface,
      });
      setState({ status: "error", message: result.error.message });
    },
    [importFile, onImport, surface],
  );

  const dismissError = () => setState({ status: "idle" });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  if (compact) {
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

  return (
    <div className="flex flex-col gap-2">
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
          className="flex items-start gap-3 rounded-[var(--ds-radius-lg,14px)] border border-ds-danger-border bg-ds-danger-surface p-4 text-sm text-ds-danger-text"
        >
          <span className="flex-1">{state.message}</span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="tiq-touch-target rounded-full border border-ds-danger-border px-3 py-1 text-xs font-medium transition hover:bg-ds-state-hover"
            >
              Try again
            </button>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={dismissError}
              className="tiq-touch-target rounded-full p-1 hover:bg-ds-state-hover"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          role="button"
          tabIndex={0}
          aria-label={`${label} — drag and drop or click to browse`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--ds-radius-xl,18px)] border-2 border-dashed px-6 py-8 text-center transition-colors ${
            isDragging
              ? "border-[var(--ds-accent,#6366f1)] bg-[var(--ds-accent,#6366f1)]/5"
              : "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.15))] hover:bg-[var(--ds-surface-sunken,#f9f9f9)]"
          } ${isUploading ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] bg-[var(--ds-surface-raised,#f4f4f5)]">
            <Upload
              className="h-5 w-5 text-[var(--ds-text-secondary,#52525b)]"
              aria-hidden="true"
            />
          </div>
          {isUploading ? (
            <span role="status" className="text-xs text-ds-text-muted">
              Uploading and validating file…
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--ds-text-primary,#18181b)]">
              {isUploading ? "Importing…" : "Drop a file or click to browse"}
            </span>
            <span className="text-xs text-[var(--ds-text-muted,#a1a1aa)]">
              {DOCUMENT_IMPORT_ACCEPT_LABEL} · max{" "}
              {DOCUMENT_IMPORT_MAX_SIZE_LABEL}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
