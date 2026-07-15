import { commentAnchorFromRecord, normalizeAnchorType } from "./anchors";
import type { CommentNode, CommentThread } from "./types";
import type { CommentReplyRecord, CommentThreadRecord } from "./records";

function displayName(author: CommentThreadRecord["author"]): string {
  return author.name ?? author.email ?? "Unknown";
}

function mapCommentNode(record: CommentReplyRecord): CommentNode {
  return {
    id: record.id,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    author: { id: record.author.id, name: displayName(record.author) },
  };
}

export function mapCommentThreadRecord(
  /* Coverage rationale: thread mapper contract is asserted; tsx maps signature row as uncovered. */
  /* node:coverage ignore next */
  record: CommentThreadRecord,
): CommentThread {
  const anchor = commentAnchorFromRecord(record);
  return {
    id: record.id,
    body: record.body,
    resolved: record.resolved,
    anchor,
    anchorType: normalizeAnchorType(record.anchorType ?? null),
    anchorText: record.anchorText ?? null,
    anchorNodeId: record.anchorNodeId ?? null,
    createdAt: record.createdAt.toISOString(),
    author: { id: record.author.id, name: displayName(record.author) },
    replies: record.replies.map(mapCommentNode),
  };
}
