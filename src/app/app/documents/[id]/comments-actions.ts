"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireDocumentActionContext } from "./document-context";
import {
  createCommentService,
  type CommentThread,
  type CreateCommentInput,
  type ListCommentsOptions,
} from "@/lib/comments";
import {
  adaptKnownCommentActionError,
  commentActionObservation,
  commentActionError,
  commentActionOk,
  type CommentActionResult,
} from "@/lib/comments/action-result";
import { logError, logInfo } from "@/lib/log";

const commentService = createCommentService({
  requireDocumentContext: requireDocumentActionContext,
});

const UNEXPECTED_COMMENT_ACTION_MESSAGE =
  "Couldn't update comments. Please try again.";

async function runCommentAction<T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<CommentActionResult<T>> {
  try {
    return commentActionOk(await execute());
  } catch (error) {
    unstable_rethrow(error);
    const observation = commentActionObservation(error);
    if (observation) {
      logInfo(
        `comments.${operation}`,
        observation.message,
        observation.context,
      );
    }
    const knownError = adaptKnownCommentActionError(error);
    if (knownError) {
      return commentActionError(knownError);
    }
    logError(`comments.${operation}`, error);
    return commentActionError({
      code: "unexpected",
      message: UNEXPECTED_COMMENT_ACTION_MESSAGE,
    });
  }
}

export async function listComments(
  documentId: string,
  options: ListCommentsOptions = {},
): Promise<CommentActionResult<CommentThread[]>> {
  return runCommentAction("list", () =>
    commentService.listComments(documentId, options),
  );
}

export async function createComment(
  documentId: string,
  input: CreateCommentInput,
): Promise<CommentActionResult<CommentThread[]>> {
  return runCommentAction("create", async () => {
    const result = await commentService.createComment(documentId, input);
    revalidatePath(`/app/documents/${result.documentId}`);
    return result.threads;
  });
}

export async function editComment(
  documentId: string,
  commentId: string,
  newBody: string,
): Promise<CommentActionResult<CommentThread[]>> {
  return runCommentAction("edit", async () => {
    const result = await commentService.editComment(
      documentId,
      commentId,
      newBody,
    );
    revalidatePath(`/app/documents/${result.documentId}`);
    return result.threads;
  });
}

export async function deleteComment(
  documentId: string,
  commentId: string,
): Promise<CommentActionResult<CommentThread[]>> {
  return runCommentAction("delete", async () => {
    const result = await commentService.deleteComment(documentId, commentId);
    revalidatePath(`/app/documents/${result.documentId}`);
    return result.threads;
  });
}

export async function setCommentResolved(
  documentId: string,
  commentId: string,
  resolved: boolean,
): Promise<CommentActionResult<CommentThread[]>> {
  return runCommentAction("resolve", async () => {
    const result = await commentService.setCommentResolved(
      documentId,
      commentId,
      resolved,
    );
    revalidatePath(`/app/documents/${result.documentId}`);
    return result.threads;
  });
}
