import type {
  CommentAnchor,
  CommentAnchorRecord,
  CommentAnchorType,
} from "@/lib/comments/anchors";
import type { CommentAuthor, CommentNode, CommentThread } from "@/lib/comments";
import type { SlideCommentAnchor } from "@/lib/comments/slide-comment-anchors";

export function buildCommentAuthor(
  overrides: Partial<CommentAuthor> = {},
): CommentAuthor {
  return {
    id: overrides.id ?? "author-fixture",
    name: overrides.name ?? "Fixture Author",
  };
}

export function buildCommentNode(
  overrides: Partial<CommentNode> = {},
): CommentNode {
  return {
    id: overrides.id ?? "comment-fixture",
    body: overrides.body ?? "Fixture comment",
    author: overrides.author ?? buildCommentAuthor(),
    createdAt: overrides.createdAt ?? "2026-06-25T00:00:00.000Z",
  };
}

export function buildCommentAnchor(
  overrides: Partial<CommentAnchor> = {},
): CommentAnchor {
  if (overrides.kind === "text") {
    return {
      kind: "text",
      text: overrides.text ?? "Selected text",
      nodeId: overrides.nodeId ?? "node-fixture",
    };
  }
  if (overrides.kind === "document-block") {
    return {
      kind: "document-block",
      blockKind: "visual",
      text: overrides.text ?? "Fixture visual",
      nodeId: overrides.nodeId ?? "visual-fixture",
    };
  }
  if (overrides.kind === "slide") {
    return {
      kind: "slide",
      slideId: overrides.slideId ?? "slide-fixture",
      geometry: overrides.geometry ?? { x: 25, y: 75 },
    };
  }
  if (overrides.kind === "slide-element") {
    return {
      kind: "slide-element",
      slideId: overrides.slideId ?? "slide-fixture",
      elementId: overrides.elementId ?? "element-fixture",
      geometry: overrides.geometry ?? { x: 25, y: 75 },
    };
  }
  return { kind: "deck" };
}

export function buildCommentThread(
  overrides: Partial<CommentThread> = {},
): CommentThread {
  const node = buildCommentNode(overrides);
  return {
    ...node,
    resolved: overrides.resolved ?? false,
    anchor: overrides.anchor ?? buildCommentAnchor(),
    anchorType: overrides.anchorType ?? null,
    anchorText: overrides.anchorText ?? null,
    anchorNodeId: overrides.anchorNodeId ?? null,
    replies: overrides.replies ?? [],
  };
}

export function buildSlideCommentAnchor(
  overrides: Partial<SlideCommentAnchor> = {},
): SlideCommentAnchor {
  return {
    slideId: overrides.slideId ?? "slide-fixture",
    elementId: overrides.elementId ?? "element-fixture",
    geometry: overrides.geometry ?? { x: 25, y: 75 },
  };
}

export function buildCommentAnchorRecord(
  overrides: Partial<CommentAnchorRecord> & {
    anchorType?: CommentAnchorType | null;
  } = {},
): CommentAnchorRecord {
  return {
    anchorType: overrides.anchorType ?? null,
    anchorText: overrides.anchorText ?? null,
    anchorNodeId: overrides.anchorNodeId ?? null,
    slideId: overrides.slideId ?? null,
    elementId: overrides.elementId ?? null,
    anchorGeometry: overrides.anchorGeometry ?? null,
  };
}
