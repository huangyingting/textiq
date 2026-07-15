import { DocumentPermissionError } from "@/lib/auth/document-permissions";

import { CommentError, type CommentErrorCode } from "./errors";

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
