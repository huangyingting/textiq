import type { Prisma } from "@/generated/prisma/client";

export const commentThreadSelect = {
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
} satisfies Prisma.CommentSelect;

export type CommentThreadRecord = Prisma.CommentGetPayload<{
  select: typeof commentThreadSelect;
}>;

export type CommentReplyRecord = CommentThreadRecord["replies"][number];
