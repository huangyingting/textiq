import { DocumentPermissionError } from "@/lib/auth/document-permissions";

import {
  CommentError,
  CommentUnavailableError,
  type CommentErrorCode,
  type CommentUnavailableClassification,
} from "./errors";

export type CommentActionErrorCode =
  | CommentErrorCode
  | "access_denied"
  | "unexpected";

export type CommentActionError = {
  code: CommentActionErrorCode;
  message: string;
};

export type CommentActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CommentActionError };

export type CommentActionObservation = {
  message: string;
  context: { classification: CommentUnavailableClassification };
};

export function commentActionOk<T>(data: T): CommentActionResult<T> {
  return { ok: true, data };
}

export function commentActionError<T = never>(
  error: CommentActionError,
): CommentActionResult<T> {
  return { ok: false, error };
}

export function adaptKnownCommentActionError(
  error: unknown,
): CommentActionError | null {
  if (error instanceof CommentError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof DocumentPermissionError) {
    return {
      code: "access_denied",
      message: "You don't have access to this document.",
    };
  }
  return null;
}

export function commentActionObservation(
  error: unknown,
): CommentActionObservation | null {
  if (!(error instanceof CommentUnavailableError)) {
    return null;
  }
  return {
    message: "Comment mutation target unavailable.",
    context: { classification: error.classification },
  };
}
