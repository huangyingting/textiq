import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Deck } from "@/lib/presentation/schema";
import { safeParseDeck } from "@/lib/presentation/validation";

import {
  COMMENT_ANCHOR_NODE_ID_MAX_LENGTH,
  COMMENT_ANCHOR_TEXT_MAX_LENGTH,
  COMMENT_BODY_MAX_LENGTH,
} from "@/lib/limits";

import {
  normalizeAnchorType,
  slideAnchorToRecord,
  validateAnchorGeometry,
  validateElementId,
  validateSlideId,
} from "./anchors";
import { CommentError } from "./errors";
import { mapCommentThreadRecord } from "./mappers";
import { canDeleteComment, canEditComment } from "./policy";
import { isCommentUnreadForScope, type UnreadCountScope } from "./read-state";
import { commentThreadSelect } from "./records";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import type {
  CommentThread,
  CreateCommentInput,
  ListCommentsOptions,
} from "./types";
import { resolveAnchorState } from "@/lib/comments/slide-comment-anchors";

type CommentDb = Pick<
  typeof prisma,
  "$transaction" | "comment" | "commentRead"
>;
type DeckLoadDb = Pick<Prisma.TransactionClient, "document">;

export type CommentCapabilityContext = {
  user: { id: string };
};

export type RequireCommentDocumentContext = (
  documentId: string,
  capability: "view",
) => Promise<CommentCapabilityContext>;

export type CommentMutationResult = {
  documentId: string;
  threads: CommentThread[];
};

export type CommentService = ReturnType<typeof createCommentService>;

export type LoadDeckForDocument = (
  documentId: string,
  db?: DeckLoadDb,
) => Promise<Deck>;

type CommentServiceDeps = {
  db?: CommentDb;
  now?: () => Date;
  requireDocumentContext: RequireCommentDocumentContext;
  loadDeckForDocument?: LoadDeckForDocument;
};

function scopedCommentWhere(options: ListCommentsOptions) {
  const { anchorScope = "all" } = options;
  const scopeWhere: Prisma.CommentWhereInput = {};

  if (anchorScope === "slide") {
    scopeWhere.slideId = { not: null };
  } else if (anchorScope === "text") {
    scopeWhere.slideId = null;
  }

  if (options.slideId !== undefined && anchorScope !== "text") {
    scopeWhere.slideId = options.slideId;
  }

  return scopeWhere;
}

export function createCommentService({
  db = prisma,
  now = () => new Date(),
  requireDocumentContext,
  loadDeckForDocument = async (
    documentId: string,
    db: DeckLoadDb = prisma,
  ): Promise<Deck> => {
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { deckJson: true },
    });
    if (!document?.deckJson) {
      throw new CommentError(
        "slide_deck_missing",
        "Slide comments require a saved deck on this document.",
      );
    }
    const parsed = safeParseDeck(document.deckJson);
    if (!parsed.success) {
      throw new CommentError(
        "slide_deck_invalid",
        "Slide comments require a valid saved presentation deck.",
      );
    }
    return parsed.data;
  },
}: CommentServiceDeps) {
  async function listCommentsForAuthorizedDocument(
    documentId: string,
    options: ListCommentsOptions = {},
  ): Promise<CommentThread[]> {
    const roots = await db.comment.findMany({
      where: {
        documentId,
        parentId: null,
        ...scopedCommentWhere(options),
      },
      orderBy: { createdAt: "asc" },
      select: commentThreadSelect,
    });

    return roots.map(mapCommentThreadRecord);
  }

  async function listComments(
    documentId: string,
    options: ListCommentsOptions = {},
  ): Promise<CommentThread[]> {
    await requireDocumentContext(documentId, "view");
    return listCommentsForAuthorizedDocument(documentId, options);
  }

  async function createComment(
    documentId: string,
    input: CreateCommentInput,
  ): Promise<CommentMutationResult> {
    const { user } = await requireDocumentContext(documentId, "view");

    const body = input.body.trim().slice(0, COMMENT_BODY_MAX_LENGTH);
    if (body.length === 0) {
      throw new CommentError("empty_body", "Comment cannot be empty.");
    }

    const parentId = input.parentId;
    if (parentId) {
      await runSerializableTransaction(db, async (tx) => {
        const parent = await tx.comment.updateMany({
          where: { id: parentId, documentId, parentId: null },
          data: { resolved: false },
        });
        if (parent.count !== 1) {
          throw new CommentError(
            "parent_not_found",
            "Parent comment not found.",
          );
        }
        await tx.comment.create({
          data: {
            documentId,
            authorId: user.id,
            body,
            parentId,
          },
        });
      });
    } else {
      const slideId = validateSlideId(input.slideId);
      const elementId = slideId ? validateElementId(input.elementId) : null;
      const geometry = validateAnchorGeometry(input.anchorGeometry ?? null);

      if (slideId) {
        const slideAnchor = {
          slideId,
          elementId,
          geometry,
        };
        const anchorRecord = slideAnchorToRecord(slideAnchor);
        await runSerializableTransaction(db, async (tx) => {
          const deck = await loadDeckForDocument(documentId, tx);
          if (resolveAnchorState(slideAnchor, deck) !== "attached") {
            throw new CommentError(
              "slide_anchor_orphaned",
              "Slide comment anchor must reference an existing slide or element in the saved deck.",
            );
          }
          await tx.comment.create({
            data: {
              documentId,
              authorId: user.id,
              body,
              slideId: anchorRecord.slideId,
              elementId: anchorRecord.elementId,
              anchorGeometry:
                anchorRecord.anchorGeometry != null
                  ? (anchorRecord.anchorGeometry as Prisma.InputJsonValue)
                  : Prisma.DbNull,
            },
          });
        });
      } else {
        const anchorType = normalizeAnchorType(input.anchorType ?? null);
        const anchorText = anchorType
          ? (input.anchorText
              ?.trim()
              .slice(0, COMMENT_ANCHOR_TEXT_MAX_LENGTH) ?? null)
          : null;
        const anchorNodeId =
          anchorType === "visual" || anchorType === "table"
            ? (input.anchorNodeId?.slice(
                0,
                COMMENT_ANCHOR_NODE_ID_MAX_LENGTH,
              ) ?? null)
            : null;
        await db.comment.create({
          data: {
            documentId,
            authorId: user.id,
            body,
            anchorType,
            anchorText,
            anchorNodeId,
          },
        });
      }
    }

    return {
      documentId,
      threads: await listCommentsForAuthorizedDocument(documentId),
    };
  }

  async function editComment(
    commentId: string,
    newBody: string,
  ): Promise<CommentMutationResult> {
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, documentId: true, authorId: true },
    });
    if (!comment) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }

    const { user } = await requireDocumentContext(comment.documentId, "view");
    if (!canEditComment(user.id, comment)) {
      throw new CommentError(
        "edit_forbidden",
        "You can only edit your own comments.",
      );
    }

    const body = newBody.trim().slice(0, COMMENT_BODY_MAX_LENGTH);
    if (body.length === 0) {
      throw new CommentError("empty_body", "Comment cannot be empty.");
    }

    const updated = await db.comment.updateMany({
      where: { id: commentId },
      data: { body },
    });
    if (updated.count !== 1) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }

    return {
      documentId: comment.documentId,
      threads: await listCommentsForAuthorizedDocument(comment.documentId),
    };
  }

  async function deleteComment(
    commentId: string,
  ): Promise<CommentMutationResult> {
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, documentId: true, authorId: true },
    });
    if (!comment) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }

    const { user } = await requireDocumentContext(comment.documentId, "view");
    if (!canDeleteComment(user.id, comment)) {
      throw new CommentError(
        "delete_forbidden",
        "You can only delete your own comments.",
      );
    }

    const deleted = await db.comment.deleteMany({ where: { id: commentId } });
    if (deleted.count !== 1) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }

    return {
      documentId: comment.documentId,
      threads: await listCommentsForAuthorizedDocument(comment.documentId),
    };
  }

  async function setCommentResolved(
    commentId: string,
    resolved: boolean,
  ): Promise<CommentMutationResult> {
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, documentId: true, parentId: true },
    });
    if (!comment) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }
    await requireDocumentContext(comment.documentId, "view");
    if (comment.parentId !== null) {
      throw new CommentError(
        "thread_required",
        "Only top-level comment threads can be resolved.",
      );
    }

    const updated = await db.comment.updateMany({
      where: { id: commentId, parentId: null },
      data: { resolved },
    });
    if (updated.count !== 1) {
      throw new CommentError("comment_not_found", "Comment not found.");
    }

    return {
      documentId: comment.documentId,
      threads: await listCommentsForAuthorizedDocument(comment.documentId),
    };
  }

  async function getUnreadCommentCount(
    documentId: string,
    scope: UnreadCountScope = "all",
  ): Promise<number> {
    const { user } = await requireDocumentContext(documentId, "view");

    const readRecord = await db.commentRead.findUnique({
      where: { userId_documentId: { userId: user.id, documentId } },
      select: { lastReadAt: true },
    });
    const lastReadAt = readRecord?.lastReadAt ?? null;

    const comments = await db.comment.findMany({
      where: {
        documentId,
        authorId: { not: user.id },
      },
      select: {
        createdAt: true,
        authorId: true,
        slideId: true,
        parent: { select: { slideId: true } },
      },
    });

    return comments.filter((comment) =>
      isCommentUnreadForScope(comment, user.id, lastReadAt, scope),
    ).length;
  }

  async function markDocumentCommentsRead(documentId: string): Promise<void> {
    const { user } = await requireDocumentContext(documentId, "view");
    const lastReadAt = now();

    await db.commentRead.upsert({
      where: { userId_documentId: { userId: user.id, documentId } },
      update: { lastReadAt },
      create: { userId: user.id, documentId, lastReadAt },
    });
  }

  return {
    listComments,
    createComment,
    editComment,
    deleteComment,
    setCommentResolved,
    getUnreadCommentCount,
    markDocumentCommentsRead,
  };
}
