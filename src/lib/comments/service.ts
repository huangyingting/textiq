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
  slideAnchorFromRecord,
  slideAnchorToRecord,
  validateAnchorGeometry,
  validateElementId,
  validateSlideId,
} from "./anchors";
import { mapCommentThreadRecord, type CommentThreadRecord } from "./mappers";
import { canDeleteComment, canEditComment } from "./policy";
import { isCommentUnread, type UnreadCountScope } from "./read-state";
import type {
  CommentThread,
  CreateCommentInput,
  ListCommentsOptions,
} from "./types";
import { resolveAnchorState } from "@/lib/comments/slide-comment-anchors";

type CommentDb = Pick<typeof prisma, "comment" | "commentRead">;

const SLIDE_COMMENT_DECK_MISSING_ERROR =
  "Slide comments require a saved deck on this document.";
const SLIDE_COMMENT_DECK_INVALID_ERROR =
  "Slide comments require a valid saved presentation deck.";
const SLIDE_COMMENT_ANCHOR_ORPHANED_ERROR =
  "Slide comment anchor must reference an existing slide or element in the saved deck.";

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

export type LoadDeckForDocument = (documentId: string) => Promise<Deck>;

type CommentServiceDeps = {
  db?: CommentDb;
  now?: () => Date;
  requireDocumentContext: RequireCommentDocumentContext;
  loadDeckForDocument?: LoadDeckForDocument;
};

function commentSelect() {
  return {
    id: true,
    body: true,
    resolved: true,
    anchorType: true,
    anchorText: true,
    anchorNodeId: true,
    slideId: true,
    elementId: true,
    anchorGeometry: true,
    createdAt: true,
    author: { select: { id: true, name: true, email: true } },
    replies: {
      orderBy: { createdAt: "asc" as const },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    },
  };
}

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

function scopedUnreadWhere(scope: UnreadCountScope): Prisma.CommentWhereInput {
  if (scope === "slide") {
    return { slideId: { not: null } };
  }
  if (scope === "text") {
    return { slideId: null };
  }
  return {};
}

export function createCommentService({
  db = prisma,
  now = () => new Date(),
  requireDocumentContext,
  loadDeckForDocument = async (documentId: string): Promise<Deck> => {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { deckJson: true },
    });
    if (!document?.deckJson) {
      throw new Error(SLIDE_COMMENT_DECK_MISSING_ERROR);
    }
    const parsed = safeParseDeck(document.deckJson);
    if (!parsed.success) {
      throw new Error(SLIDE_COMMENT_DECK_INVALID_ERROR);
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
      select: commentSelect(),
    });

    return roots.map((root) =>
      mapCommentThreadRecord(root as CommentThreadRecord),
    );
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
      throw new Error("Comment cannot be empty.");
    }

    if (input.parentId) {
      const parent = await db.comment.findFirst({
        where: { id: input.parentId, documentId, parentId: null },
        select: { id: true },
      });
      if (!parent) {
        throw new Error("Parent comment not found.");
      }

      await db.comment.create({
        data: {
          documentId,
          authorId: user.id,
          body,
          parentId: parent.id,
        },
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
        const deck = await loadDeckForDocument(documentId);
        if (resolveAnchorState(slideAnchor, deck) !== "attached") {
          throw new Error(SLIDE_COMMENT_ANCHOR_ORPHANED_ERROR);
        }
        const anchorRecord = slideAnchorToRecord(slideAnchor);
        await db.comment.create({
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
      throw new Error("Comment not found.");
    }

    const { user } = await requireDocumentContext(comment.documentId, "view");
    if (!canEditComment(user.id, comment)) {
      throw new Error("You can only edit your own comments.");
    }

    const body = newBody.trim().slice(0, COMMENT_BODY_MAX_LENGTH);
    if (body.length === 0) {
      throw new Error("Comment cannot be empty.");
    }

    await db.comment.update({
      where: { id: commentId },
      data: { body },
    });

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
      throw new Error("Comment not found.");
    }

    const { user } = await requireDocumentContext(comment.documentId, "view");
    if (!canDeleteComment(user.id, comment)) {
      throw new Error("You can only delete your own comments.");
    }

    await db.comment.delete({ where: { id: commentId } });

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
      select: { id: true, documentId: true },
    });
    if (!comment) {
      throw new Error("Comment not found.");
    }

    await requireDocumentContext(comment.documentId, "view");
    await db.comment.update({
      where: { id: commentId },
      data: { resolved },
    });

    return {
      documentId: comment.documentId,
      threads: await listCommentsForAuthorizedDocument(comment.documentId),
    };
  }

  async function floatCommentsOnSlideDelete(
    documentId: string,
    slideId: string,
  ): Promise<void> {
    await requireDocumentContext(documentId, "view");
    await db.comment.updateMany({
      where: { documentId, slideId },
      data: { slideId: null, elementId: null, anchorGeometry: Prisma.DbNull },
    });
  }

  async function floatCommentsOnElementDelete(
    documentId: string,
    slideId: string,
    elementId: string,
  ): Promise<void> {
    await requireDocumentContext(documentId, "view");
    await db.comment.updateMany({
      where: { documentId, slideId, elementId },
      data: { elementId: null },
    });
  }

  async function getOrphanedCommentIds(
    documentId: string,
    deck: Deck,
  ): Promise<string[]> {
    await requireDocumentContext(documentId, "view");

    const slideAnchoredComments = await db.comment.findMany({
      where: { documentId, parentId: null, slideId: { not: null } },
      select: {
        id: true,
        slideId: true,
        elementId: true,
        /*! node:coverage ignore next 3 -- orphaned-comment tests assert geometry selection; tsx maps the select-object tail as uncovered. */
        anchorGeometry: true,
      },
    });

    return slideAnchoredComments
      .filter(
        (comment) =>
          resolveAnchorState(slideAnchorFromRecord(comment), deck) ===
          "orphaned",
      )
      .map((comment) => comment.id);
  }

  async function floatOrphanedCommentsAfterRestore(
    documentId: string,
    deck: Deck,
  ): Promise<{ floatedCount: number }> {
    const orphanedIds = await getOrphanedCommentIds(documentId, deck);

    if (orphanedIds.length > 0) {
      await db.comment.updateMany({
        where: { id: { in: orphanedIds } },
        data: { slideId: null, elementId: null, anchorGeometry: Prisma.DbNull },
      });
    }

    return { floatedCount: orphanedIds.length };
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
        parentId: null,
        authorId: { not: user.id },
        ...scopedUnreadWhere(scope),
      },
      select: { createdAt: true, authorId: true },
    });

    return comments.filter((comment) =>
      isCommentUnread(comment, user.id, lastReadAt),
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
    floatCommentsOnSlideDelete,
    floatCommentsOnElementDelete,
    getOrphanedCommentIds,
    floatOrphanedCommentsAfterRestore,
    getUnreadCommentCount,
    markDocumentCommentsRead,
  };
}
