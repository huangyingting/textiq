"use client";

import { useCallback, useRef, useState } from "react";

import type {
  DocumentImportActionPort,
  ImportedDocumentPayload,
} from "@/lib/action-ports";
import { IMPORT_MAX_UPLOAD_BYTES } from "@/lib/limits/assets";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
  reasonFromStatus,
} from "@/lib/telemetry/product";

export const DOCUMENT_IMPORT_ACCEPT = ".md,.html,.htm,.docx,.pptx,.pdf";
export const DOCUMENT_IMPORT_ACCEPT_LABEL = ".md, .html, .docx, .pptx, .pdf";
export const DOCUMENT_IMPORT_MAX_SIZE_LABEL = "20 MB";

export type DocumentImportState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string };

function deriveImportedDocumentTitle(fileName: string): string {
  return (
    fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") ||
    "Imported document"
  );
}

const routeDocumentImportPort: DocumentImportActionPort = {
  async importFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as
        | { markdown: string }
        | { error: string };
      if (!response.ok || "error" in data) {
        return {
          ok: false,
          error: "error" in data ? data.error : "Import failed.",
        };
      }
      return {
        ok: true,
        data: {
          markdown: data.markdown,
          title: deriveImportedDocumentTitle(file.name),
        },
      };
    } catch {
      return {
        ok: false,
        error: "Could not reach the server. Please try again.",
      };
    }
  },
};

export function useDocumentImportWorkflow({
  onImported,
  surface,
  port = routeDocumentImportPort,
}: {
  onImported: (payload: ImportedDocumentPayload) => void;
  surface: "dashboard" | "workspace" | "toolbar" | "dropzone";
  port?: DocumentImportActionPort;
}) {
  const [state, setState] = useState<DocumentImportState>({ status: "idle" });
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
      const result = await port.importFile(file);
      if (result.ok) {
        emitProductTelemetry("product.import.succeeded", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          fileSizeBucket,
          fileType,
          surface,
        });
        setState({ status: "idle" });
        onImported(result.data);
        return;
      }
      emitProductTelemetry("product.import.failed", {
        durationBucket: bucketDurationMs(performance.now() - startedAt),
        failureReason:
          result.error === "Could not reach the server. Please try again."
            ? "network"
            : reasonFromStatus(400),
        fileSizeBucket,
        fileType,
        surface,
      });
      setState({ status: "error", message: result.error });
    },
    [onImported, port, surface],
  );

  return {
    inputRef,
    state,
    isUploading: state.status === "uploading",
    processFile,
    dismissError: () => setState({ status: "idle" }),
    clearError: () => {
      if (state.status === "error") setState({ status: "idle" });
    },
    openFilePicker: () => inputRef.current?.click(),
  };
}
