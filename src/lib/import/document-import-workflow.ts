"use client";

import { useCallback, useRef, useState } from "react";

import type {
  DocumentImportActionPort,
  DocumentImportCreateActionPort,
  ImportActionError,
  ImportActionResult,
  ImportedDocumentCreationPayload,
  ImportedDocumentPayload,
} from "@/lib/action-ports";
import {
  importErrorStatusForCode,
  isImportErrorCode,
  parseImportRouteResult,
  type ImportCreationTarget,
  type ImportRouteResult,
} from "@/lib/import/contract";
import {
  IMPORT_ACCEPT,
  IMPORT_ACCEPT_LABEL,
  IMPORT_MAX_SIZE_LABEL,
  IMPORT_MAX_UPLOAD_BYTES,
} from "@/lib/import/format-registry";
import { deriveImportedDocumentTitle } from "@/lib/import/title";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
  reasonFromImportError,
  reasonFromStatus,
} from "@/lib/telemetry/product";
import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from "@/lib/type-guards";

export const DOCUMENT_IMPORT_ACCEPT = IMPORT_ACCEPT;
export const DOCUMENT_IMPORT_ACCEPT_LABEL = IMPORT_ACCEPT_LABEL;
export const DOCUMENT_IMPORT_MAX_SIZE_LABEL = IMPORT_MAX_SIZE_LABEL;

type ImportSurface = "dashboard" | "workspace" | "toolbar" | "dropzone";

export type DocumentImportState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string };

type ParsedErrorBody = {
  code: string;
  message: string;
};

type ImportRouteRequestResult =
  | { ok: true; data: Exclude<ImportRouteResult, { ok: false }> }
  | { ok: false; error: ImportActionError };

function parseErrorBody(value: unknown): ParsedErrorBody | null {
  if (!isPlainObject(value) || !isNonEmptyString(value.error)) {
    return null;
  }
  return {
    code: isNonEmptyString(value.code) ? value.code : "unknown_error",
    message: value.error,
  };
}

function statusOrFallback(status: number): number {
  return isFiniteNumber(status) && status > 0 ? status : 500;
}

function malformedResponseError(status: number): ImportActionError {
  return {
    code: "malformed_response",
    status: statusOrFallback(status),
    message: "The server returned an invalid import response.",
  };
}

function unexpectedSuccessModeError(
  expectedMode: "parse" | "create",
): ImportActionError {
  return {
    code: "unexpected_mode",
    status: 500,
    message:
      expectedMode === "parse"
        ? "Import succeeded, but markdown content was missing."
        : "Import succeeded, but document metadata was missing.",
  };
}

async function callImportRoute(
  formData: FormData,
): Promise<ImportRouteRequestResult> {
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      body: formData,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: malformedResponseError(response.status) };
    }

    const parsed = parseImportRouteResult(payload);
    if (parsed) {
      if (!parsed.ok) {
        return {
          ok: false,
          error: {
            code: parsed.error.code,
            status: parsed.error.status,
            message: parsed.error.message,
          },
        };
      }
      return { ok: true, data: parsed };
    }

    const fallback = parseErrorBody(payload);
    if (fallback) {
      return {
        ok: false,
        error: {
          code: fallback.code,
          status: statusOrFallback(response.status),
          message: fallback.message,
        },
      };
    }

    return { ok: false, error: malformedResponseError(response.status) };
  } catch {
    return {
      ok: false,
      error: {
        code: "network",
        status: 0,
        message: "Could not reach the server. Please try again.",
      },
    };
  }
}

function importFailureReason(error: ImportActionError): string {
  if (error.code === "network") {
    return "network";
  }
  if (isImportErrorCode(error.code)) {
    return reasonFromImportError({
      code: error.code,
      status: importErrorStatusForCode(error.code),
      message: error.message,
    });
  }
  return reasonFromStatus(error.status);
}

const routeDocumentImportPort: DocumentImportActionPort = {
  async importFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    const result = await callImportRoute(formData);
    if (!result.ok) {
      return result;
    }
    if (result.data.mode !== "parse") {
      return { ok: false, error: unexpectedSuccessModeError("parse") };
    }
    return {
      ok: true,
      data: {
        markdown: result.data.markdown,
        title: deriveImportedDocumentTitle(file.name),
      },
    };
  },
};

const routeDocumentImportCreatePort: DocumentImportCreateActionPort = {
  async importFile(file, target) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target", target.kind);
    if (target.kind === "workspace") {
      formData.append("workspaceId", target.workspaceId);
    }

    const result = await callImportRoute(formData);
    if (!result.ok) {
      return result;
    }
    if (result.data.mode !== "create") {
      return { ok: false, error: unexpectedSuccessModeError("create") };
    }
    return {
      ok: true,
      data: {
        documentId: result.data.documentId,
        documentPath: result.data.documentPath,
      },
    };
  },
};

function useImportWorkflow<TPayload>(input: {
  onSuccess: (payload: TPayload) => void;
  surface: ImportSurface;
  importFile: (file: File) => Promise<ImportActionResult<TPayload>>;
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
          surface: input.surface,
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
        surface: input.surface,
      });

      const result = await input.importFile(file);
      if (result.ok) {
        emitProductTelemetry("product.import.succeeded", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          fileSizeBucket,
          fileType,
          surface: input.surface,
        });
        setState({ status: "idle" });
        input.onSuccess(result.data);
        return;
      }

      emitProductTelemetry("product.import.failed", {
        durationBucket: bucketDurationMs(performance.now() - startedAt),
        failureReason: importFailureReason(result.error),
        fileSizeBucket,
        fileType,
        status: result.error.status,
        surface: input.surface,
      });
      setState({ status: "error", message: result.error.message });
    },
    [input],
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

export function useDocumentImportWorkflow({
  onImported,
  surface,
  port = routeDocumentImportPort,
}: {
  onImported: (payload: ImportedDocumentPayload) => void;
  surface: ImportSurface;
  port?: DocumentImportActionPort;
}) {
  return useImportWorkflow({
    onSuccess: onImported,
    surface,
    importFile: (file) => port.importFile(file),
  });
}

export function useDocumentImportCreationWorkflow({
  onCreated,
  surface,
  target,
  port = routeDocumentImportCreatePort,
}: {
  onCreated: (payload: ImportedDocumentCreationPayload) => void;
  surface: ImportSurface;
  target: ImportCreationTarget;
  port?: DocumentImportCreateActionPort;
}) {
  return useImportWorkflow({
    onSuccess: onCreated,
    surface,
    importFile: (file) => port.importFile(file, target),
  });
}
