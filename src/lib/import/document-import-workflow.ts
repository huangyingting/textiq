"use client";

import { useCallback, useRef, useState } from "react";

import type {
  DocumentImportCreateActionPort,
  ImportActionError,
  ImportActionResult,
  ImportedDocumentCreationPayload,
} from "@/lib/action-ports";
import {
  isImportErrorCode,
  parseImportRouteResult,
  type ImportCreationTarget,
} from "@/lib/import/contract";
import {
  IMPORT_ACCEPT,
  IMPORT_MAX_SIZE_LABEL,
  IMPORT_MAX_UPLOAD_BYTES,
} from "@/lib/import/format-registry";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
} from "@/lib/telemetry/product";

export const DOCUMENT_IMPORT_ACCEPT = IMPORT_ACCEPT;
export const DOCUMENT_IMPORT_MAX_SIZE_LABEL = IMPORT_MAX_SIZE_LABEL;

type ImportSurface = "dashboard" | "workspace";

export type DocumentImportState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string };

type ParsedImportRouteSuccess = Extract<
  NonNullable<ReturnType<typeof parseImportRouteResult>>,
  { ok: true }
>;

type ImportRouteRequestResult =
  | { ok: true; data: ParsedImportRouteSuccess }
  | { ok: false; error: ImportActionError };

function malformedResponseError(status: number): ImportActionError {
  return {
    code: "malformed_response",
    status,
    message: "The server returned an invalid import response.",
  };
}

function networkError(): ImportActionError {
  return {
    code: "network",
    status: 0,
    message: "Could not reach the server. Please try again.",
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
    if (!parsed) {
      return { ok: false, error: malformedResponseError(response.status) };
    }
    if (!parsed.ok) {
      if (parsed.error.status !== response.status) {
        return { ok: false, error: malformedResponseError(response.status) };
      }
      return {
        ok: false,
        error: {
          code: parsed.error.code,
          status: parsed.error.status,
          message: parsed.error.message,
        },
      };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: malformedResponseError(response.status) };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: networkError() };
  }
}

function importFailureReason(error: ImportActionError): string {
  if (error.code === "network") {
    return "network";
  }
  if (isImportErrorCode(error.code)) {
    return error.code;
  }
  return "unknown";
}

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
          surface: input.surface,
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
        surface: input.surface,
      });

      let result: ImportActionResult<TPayload>;
      try {
        result = await input.importFile(file);
      } catch {
        result = { ok: false, error: networkError() };
      }
      isUploadingRef.current = false;
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
    clearError: () => {
      if (state.status === "error") setState({ status: "idle" });
    },
  };
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
