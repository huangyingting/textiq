export type UnreadCountScope = "all" | "text" | "slide";

export type CommentUnreadRecord = {
  createdAt: Date;
  authorId: string;
  slideId: string | null;
  parent: { slideId: string | null } | null;
};

export function isCommentUnread(
  comment: { createdAt: Date; authorId: string },
  userId: string,
  lastReadAt: Date | null,
): boolean {
  if (comment.authorId === userId) {
    return false;
  }
  if (lastReadAt === null) {
    return true;
  }
  return comment.createdAt > lastReadAt;
}

export function commentUnreadScope(
  comment: Pick<CommentUnreadRecord, "slideId" | "parent">,
): Exclude<UnreadCountScope, "all"> {
  return (comment.parent?.slideId ?? comment.slideId) === null
    ? "text"
    : "slide";
}

export function isCommentUnreadForScope(
  comment: CommentUnreadRecord,
  userId: string,
  lastReadAt: Date | null,
  scope: UnreadCountScope,
): boolean {
  return (
    (scope === "all" || commentUnreadScope(comment) === scope) &&
    isCommentUnread(comment, userId, lastReadAt)
  );
}
