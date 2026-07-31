"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { GUTTER_BUTTON } from "@/components/ui/tokens";
import { Button, IconButton } from "@/components/ui";
import { cx, FIELD_CONTROL, RADIUS } from "@/components/ui/tokens";

import {
  createComment,
  deleteComment,
  editComment,
  setCommentResolved,
} from "./comments-actions";
import type { CommentsActionPort } from "@/lib/action-ports";
import type { CommentActionResult, CommentThread } from "@/lib/comments";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/limits";
import {
  COMMENT_CARD_VIEWPORT_BLOCK_GAP,
  anchorPositionForBlock,
  commentBlockAtY,
  computeCommentCardPosition,
  isInRightCommentGutter,
  isTextCommentBlock,
  normalizeInlineAnchorText,
  preferredRightSideCardLeft,
  type AnchorPosition,
  type CommentCardPosition,
} from "./inline-comment-dom";

const commentsActions: Pick<
  CommentsActionPort,
  "createComment" | "editComment" | "deleteComment" | "setCommentResolved"
> = {
  createComment,
  editComment,
  deleteComment,
  setCommentResolved,
};

const COMMENT_ACTION_CLASS =
  "text-[11px] font-semibold text-ds-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50";

type CommentMutationAction = {
  kind: "create" | "edit" | "delete" | "resolve";
  commentId?: string;
};

function subscribeToHydrationStore(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function threadsByTextAnchor(
  threads: CommentThread[],
): Map<string, CommentThread[]> {
  const map = new Map<string, CommentThread[]>();
  for (const thread of threads) {
    if (thread.anchorType !== "text" || !thread.anchorText) {
      continue;
    }
    const key = textAnchorKey({
      nodeId: thread.anchorNodeId,
      text: normalizeInlineAnchorText(thread.anchorText),
    });
    const current = map.get(key) ?? [];
    current.push(thread);
    map.set(key, current);
  }
  return map;
}

function textAnchorKey(
  anchor: Pick<AnchorPosition, "nodeId" | "text">,
): string {
  return anchor.nodeId
    ? `node\u0000${anchor.nodeId}`
    : `text\u0000${anchor.text}`;
}

function threadsForAnchor(
  map: Map<string, CommentThread[]>,
  anchor: AnchorPosition,
): CommentThread[] {
  const exact = map.get(textAnchorKey(anchor)) ?? [];
  if (!anchor.nodeId) {
    return exact;
  }
  return [
    ...exact,
    ...(map.get(textAnchorKey({ nodeId: null, text: anchor.text })) ?? []),
  ];
}

type CommentDot = AnchorPosition & { count: number };

function commentDotsEqual(
  current: readonly CommentDot[],
  next: readonly CommentDot[],
): boolean {
  return (
    current.length === next.length &&
    current.every((dot, index) => {
      const candidate = next[index];
      return (
        candidate !== undefined &&
        dot.text === candidate.text &&
        dot.nodeId === candidate.nodeId &&
        dot.top === candidate.top &&
        dot.iconLeft === candidate.iconLeft &&
        dot.markerLeft === candidate.markerLeft &&
        dot.count === candidate.count
      );
    })
  );
}

export function InlineCommentsLayer({
  documentId,
  currentUserId,
  initialComments,
}: {
  documentId: string;
  currentUserId: string;
  initialComments: CommentThread[];
}) {
  const [editor] = useLexicalComposerContext();
  const canUsePortal = useSyncExternalStore(
    subscribeToHydrationStore,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [threads, setThreads] = useState(initialComments);
  const [hoverAnchor, setHoverAnchor] = useState<AnchorPosition | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<AnchorPosition | null>(null);
  const [body, setBody] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [cardPosition, setCardPosition] = useState<CommentCardPosition | null>(
    null,
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mutationInFlightRef = useRef(false);
  const [pendingAction, setPendingAction] =
    useState<CommentMutationAction | null>(null);
  const [isPending, startTransition] = useTransition();
  const mutationBusy = isPending || pendingAction !== null;

  const byAnchor = useMemo(() => threadsByTextAnchor(threads), [threads]);

  const closeDialog = useCallback(() => {
    if (mutationInFlightRef.current) return;
    setActiveAnchor(null);
    setBody("");
    setReplyingToId(null);
    setEditingCommentId(null);
    setEditBody("");
    setDeletingCommentId(null);
    setError(null);
  }, []);

  const runMutation = useCallback(
    (
      action: CommentMutationAction,
      mutate: () => Promise<CommentActionResult<CommentThread[]>>,
      fallbackMessage: string,
      onSuccess?: () => void,
    ) => {
      if (mutationInFlightRef.current) return;

      mutationInFlightRef.current = true;
      setError(null);
      setPendingAction(action);
      startTransition(async () => {
        try {
          const result = await mutate();
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          setThreads(result.data);
          onSuccess?.();
        } catch (error) {
          unstable_rethrow(error);
          setError(fallbackMessage);
        } finally {
          mutationInFlightRef.current = false;
          setPendingAction(null);
        }
      });
    },
    [],
  );

  const computeCommentDots = useCallback(() => {
    const root = editor.getRootElement();
    if (!root) {
      return [] as CommentDot[];
    }
    const seen = new Set<string>();
    const dots: CommentDot[] = [];
    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement) || !isTextCommentBlock(child)) {
        continue;
      }
      const position = anchorPositionForBlock(child, root);
      if (!position) {
        continue;
      }
      const key = textAnchorKey(position);
      if (seen.has(key)) {
        continue;
      }
      const count = threadsForAnchor(byAnchor, position).filter(
        (thread) => !thread.resolved,
      ).length;
      if (count > 0) {
        seen.add(key);
        dots.push({ ...position, count });
      }
    }
    return dots;
  }, [byAnchor, editor]);

  const [commentDots, setCommentDots] = useState<CommentDot[]>([]);

  const refreshPositions = useCallback(() => {
    const next = computeCommentDots();
    setCommentDots((current) =>
      commentDotsEqual(current, next) ? current : next,
    );
  }, [computeCommentDots]);

  useEffect(() => {
    let frame: number | null = null;
    let refreshScheduled = false;
    const scheduleRefresh = () => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      frame = requestAnimationFrame(() => {
        refreshScheduled = false;
        frame = null;
        refreshPositions();
      });
    };

    scheduleRefresh();
    const unregisterUpdateListener =
      editor.registerUpdateListener(scheduleRefresh);
    return () => {
      unregisterUpdateListener();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor, refreshPositions]);

  useEffect(() => {
    let cleanupRoot: (() => void) | null = null;

    const onScrollOrResize = (event: Event) => {
      const card = cardRef.current;
      if (
        event.type === "scroll" &&
        card !== null &&
        event.target instanceof Node &&
        card.contains(event.target)
      ) {
        return;
      }
      setHoverAnchor(null);
      closeDialog();
      refreshPositions();
    };

    const detachRoot = () => {
      cleanupRoot?.();
      cleanupRoot = null;
    };

    const unregisterRoot = editor.registerRootListener((root, prevRoot) => {
      if (prevRoot !== null) {
        detachRoot();
      }
      if (root === null) {
        return;
      }

      const onMouseMove = (event: MouseEvent) => {
        if (activeAnchor) return;
        if (!isInRightCommentGutter(root, event.clientX)) {
          setHoverAnchor(null);
          return;
        }
        const block = commentBlockAtY(root, event.clientY);
        setHoverAnchor(block ? anchorPositionForBlock(block, root) : null);
      };
      window.addEventListener("mousemove", onMouseMove);
      const frame = requestAnimationFrame(refreshPositions);
      cleanupRoot = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("mousemove", onMouseMove);
      };
    });

    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      unregisterRoot();
      detachRoot();
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [activeAnchor, closeDialog, editor, refreshPositions]);

  useEffect(() => {
    if (!activeAnchor) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeAnchor, closeDialog]);

  const submit = useCallback(() => {
    const anchor = activeAnchor;
    const trimmed = body.trim();
    if (!anchor || !trimmed) return;
    const parentId = replyingToId;
    runMutation(
      { kind: "create" },
      () =>
        commentsActions.createComment(
          documentId,
          parentId
            ? { body: trimmed, parentId }
            : {
                body: trimmed,
                anchorType: "text",
                anchorText: anchor.text,
                anchorNodeId: anchor.nodeId,
              },
        ),
      "Couldn't post your comment. Please try again.",
      () => {
        setBody("");
        setReplyingToId(null);
        if (!parentId) {
          setActiveAnchor(null);
          setHoverAnchor(null);
        }
      },
    );
  }, [activeAnchor, body, documentId, replyingToId, runMutation]);

  const activeThreads = activeAnchor
    ? threadsForAnchor(byAnchor, activeAnchor)
    : [];
  const openThreadCount = activeThreads.filter(
    (thread) => !thread.resolved,
  ).length;
  const resolvedThreadCount = activeThreads.length - openThreadCount;
  const replyingToThread =
    activeThreads.find((thread) => thread.id === replyingToId) ?? null;
  const visibleHoverAnchor =
    hoverAnchor &&
    threadsForAnchor(byAnchor, hoverAnchor).some((thread) => !thread.resolved)
      ? null
      : hoverAnchor;
  const iconAnchor = activeAnchor ?? visibleHoverAnchor;

  useLayoutEffect(() => {
    if (!activeAnchor) {
      return;
    }

    const card = cardRef.current;
    const maxHeight = Math.max(
      180,
      window.innerHeight - COMMENT_CARD_VIEWPORT_BLOCK_GAP * 2,
    );

    const updateCardPosition = () => {
      const next = computeCommentCardPosition({
        anchor: activeAnchor,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        measuredWidth: card?.offsetWidth ?? 0,
        measuredHeight: card?.offsetHeight ?? 0,
      });

      setCardPosition((current) =>
        current?.anchorText === activeAnchor.text &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.left - next.left) < 0.5 &&
        current.maxHeight === maxHeight
          ? current
          : next,
      );
    };

    updateCardPosition();

    if (!card) {
      return;
    }

    const observer = new ResizeObserver(updateCardPosition);
    observer.observe(card);
    return () => observer.disconnect();
  }, [activeAnchor, activeThreads.length, body, error, replyingToId]);

  const measuredCardPosition =
    cardPosition?.anchorText === activeAnchor?.text ? cardPosition : null;

  if (!canUsePortal) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-raised">
      {commentDots.map((dot) => (
        <button
          key={textAnchorKey(dot)}
          type="button"
          aria-label={`${dot.count} comment${dot.count === 1 ? "" : "s"}`}
          onClick={() => setActiveAnchor(dot)}
          disabled={mutationBusy}
          className={cx(
            "pointer-events-auto absolute -translate-y-1/2",
            GUTTER_BUTTON,
          )}
          style={{ top: dot.top, left: dot.markerLeft }}
        >
          <MessagesSquare aria-hidden="true" className="h-5 w-5" />
          {dot.count > 1 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ds-warning px-1 text-[10px] font-semibold leading-none text-ds-surface-base ring-1 ring-ds-surface-base">
              {dot.count > 9 ? "9+" : dot.count}
            </span>
          ) : null}
          <span className="sr-only">Open comments</span>
        </button>
      ))}

      {iconAnchor ? (
        <button
          type="button"
          aria-label="Add comment to this paragraph"
          onClick={() => setActiveAnchor(iconAnchor)}
          disabled={mutationBusy}
          className={cx(
            "pointer-events-auto absolute -translate-y-1/2",
            GUTTER_BUTTON,
          )}
          style={{
            top: iconAnchor.top,
            left: iconAnchor.iconLeft,
          }}
        >
          <MessageSquare aria-hidden="true" className="h-5 w-5" />
        </button>
      ) : null}

      {activeAnchor ? (
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Inline comments"
          aria-busy={mutationBusy}
          className={cx(
            "pointer-events-auto absolute flex w-[15rem] max-w-[calc(100vw-4.5rem)] flex-col overflow-hidden border border-ds-border-subtle bg-ds-surface-overlay text-ds-text-primary",
            RADIUS.lg,
          )}
          style={{
            top:
              measuredCardPosition?.top ??
              activeAnchor.top - COMMENT_CARD_VIEWPORT_BLOCK_GAP,
            left:
              measuredCardPosition?.left ??
              preferredRightSideCardLeft(activeAnchor),
            maxHeight: measuredCardPosition
              ? `${measuredCardPosition.maxHeight}px`
              : `calc(100vh - ${COMMENT_CARD_VIEWPORT_BLOCK_GAP * 2}px)`,
          }}
        >
          <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface-raised/70 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-overlay text-ds-text-muted">
                  <MessagesSquare aria-hidden="true" className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-ds-text-primary">
                    Comment
                  </div>
                  {activeThreads.length > 0 ? (
                    <div className="text-[10px] font-medium leading-3 text-ds-text-muted">
                      {openThreadCount} open
                      {resolvedThreadCount > 0
                        ? ` · ${resolvedThreadCount} resolved`
                        : ""}
                    </div>
                  ) : null}
                </div>
              </div>
              <IconButton
                aria-label="Close inline comment"
                size="sm"
                onClick={closeDialog}
                disabled={mutationBusy}
                className="shrink-0"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
            {activeThreads.length > 0 ? (
              <ul className="mb-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {activeThreads.map((thread) => (
                  <li
                    key={thread.id}
                    className="rounded-md bg-ds-surface-raised px-2 py-1.5 text-xs"
                  >
                    <div className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-surface-overlay text-ds-text-muted ring-1 ring-ds-border-subtle">
                        <UserRound aria-hidden="true" className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-ds-text-primary">
                            {thread.author.name}
                          </span>
                          {thread.resolved ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-ds-success-text">
                              Resolved
                            </span>
                          ) : null}
                        </div>
                        {editingCommentId === thread.id ? (
                          <div className="mt-1.5 space-y-1.5">
                            <textarea
                              aria-label={`Edit comment by ${thread.author.name}`}
                              value={editBody}
                              disabled={mutationBusy}
                              onChange={(event) => {
                                setEditBody(event.target.value);
                                setError(null);
                              }}
                              rows={2}
                              maxLength={COMMENT_BODY_MAX_LENGTH}
                              className={cx(
                                "min-h-16 w-full resize-none px-2 py-1.5",
                                FIELD_CONTROL,
                              )}
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                className={COMMENT_ACTION_CLASS}
                                aria-label={`Cancel editing comment by ${thread.author.name}`}
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditBody("");
                                  setError(null);
                                }}
                                disabled={mutationBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={COMMENT_ACTION_CLASS}
                                aria-label={`Save comment by ${thread.author.name}`}
                                onClick={() => {
                                  const nextBody = editBody.trim();
                                  if (!nextBody) return;
                                  runMutation(
                                    {
                                      kind: "edit",
                                      commentId: thread.id,
                                    },
                                    () =>
                                      commentsActions.editComment(
                                        documentId,
                                        thread.id,
                                        nextBody,
                                      ),
                                    "Couldn't edit your comment. Please try again.",
                                    () => {
                                      setEditingCommentId(null);
                                      setEditBody("");
                                    },
                                  );
                                }}
                                disabled={
                                  mutationBusy || editBody.trim().length === 0
                                }
                              >
                                {pendingAction?.kind === "edit" &&
                                pendingAction.commentId === thread.id
                                  ? "Saving…"
                                  : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-0.5 whitespace-pre-wrap leading-5 text-ds-text-secondary">
                              {thread.body}
                            </p>
                            {deletingCommentId === thread.id ? (
                              <div className="mt-1.5 rounded-md border border-ds-danger-border bg-ds-danger-surface px-2 py-1.5 text-ds-danger-text">
                                <p className="text-[11px] font-medium">
                                  Delete this thread and all of its replies?
                                </p>
                                <div className="mt-1 flex justify-end gap-2">
                                  <button
                                    type="button"
                                    className={COMMENT_ACTION_CLASS}
                                    aria-label={`Cancel deleting comment by ${thread.author.name}`}
                                    onClick={() => {
                                      setDeletingCommentId(null);
                                      setError(null);
                                    }}
                                    disabled={mutationBusy}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className={COMMENT_ACTION_CLASS}
                                    aria-label={`Confirm delete comment by ${thread.author.name}`}
                                    onClick={() =>
                                      runMutation(
                                        {
                                          kind: "delete",
                                          commentId: thread.id,
                                        },
                                        () =>
                                          commentsActions.deleteComment(
                                            documentId,
                                            thread.id,
                                          ),
                                        "Couldn't delete your comment. Please try again.",
                                        () => setDeletingCommentId(null),
                                      )
                                    }
                                    disabled={mutationBusy}
                                  >
                                    {pendingAction?.kind === "delete" &&
                                    pendingAction.commentId === thread.id
                                      ? "Deleting…"
                                      : "Delete"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                                <button
                                  type="button"
                                  className={COMMENT_ACTION_CLASS}
                                  aria-label={`Reply to comment by ${thread.author.name}`}
                                  onClick={() => {
                                    setReplyingToId(thread.id);
                                    setEditingCommentId(null);
                                    setEditBody("");
                                    setDeletingCommentId(null);
                                    setBody("");
                                    setError(null);
                                  }}
                                  disabled={mutationBusy}
                                >
                                  Reply
                                </button>
                                <button
                                  type="button"
                                  className={COMMENT_ACTION_CLASS}
                                  aria-label={`${thread.resolved ? "Reopen" : "Resolve"} comment by ${thread.author.name}`}
                                  onClick={() =>
                                    runMutation(
                                      {
                                        kind: "resolve",
                                        commentId: thread.id,
                                      },
                                      () =>
                                        commentsActions.setCommentResolved(
                                          documentId,
                                          thread.id,
                                          !thread.resolved,
                                        ),
                                      "Couldn't update this thread. Please try again.",
                                    )
                                  }
                                  disabled={mutationBusy}
                                >
                                  {pendingAction?.kind === "resolve" &&
                                  pendingAction.commentId === thread.id
                                    ? thread.resolved
                                      ? "Reopening…"
                                      : "Resolving…"
                                    : thread.resolved
                                      ? "Reopen"
                                      : "Resolve"}
                                </button>
                                {thread.author.id === currentUserId ? (
                                  <>
                                    <button
                                      type="button"
                                      className={COMMENT_ACTION_CLASS}
                                      aria-label={`Edit comment by ${thread.author.name}`}
                                      onClick={() => {
                                        setEditingCommentId(thread.id);
                                        setEditBody(thread.body);
                                        setReplyingToId(null);
                                        setBody("");
                                        setDeletingCommentId(null);
                                        setError(null);
                                      }}
                                      disabled={mutationBusy}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className={COMMENT_ACTION_CLASS}
                                      aria-label={`Delete comment by ${thread.author.name}`}
                                      onClick={() => {
                                        setDeletingCommentId(thread.id);
                                        setEditingCommentId(null);
                                        setEditBody("");
                                        setReplyingToId(null);
                                        setBody("");
                                        setError(null);
                                      }}
                                      disabled={mutationBusy}
                                    >
                                      Delete
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {thread.replies.length > 0 ? (
                      <ul
                        aria-label={`Replies to ${thread.author.name}`}
                        className="ml-7 mt-1.5 space-y-1 border-l border-ds-border-subtle pl-2"
                      >
                        {thread.replies.map((reply) => (
                          <li key={reply.id} className="py-1">
                            <span className="font-medium text-ds-text-primary">
                              {reply.author.name}
                            </span>
                            {editingCommentId === reply.id ? (
                              <div className="mt-1.5 space-y-1.5">
                                <textarea
                                  aria-label={`Edit reply by ${reply.author.name}`}
                                  value={editBody}
                                  disabled={mutationBusy}
                                  onChange={(event) => {
                                    setEditBody(event.target.value);
                                    setError(null);
                                  }}
                                  rows={2}
                                  maxLength={COMMENT_BODY_MAX_LENGTH}
                                  className={cx(
                                    "min-h-16 w-full resize-none px-2 py-1.5",
                                    FIELD_CONTROL,
                                  )}
                                  autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    className={COMMENT_ACTION_CLASS}
                                    aria-label={`Cancel editing reply by ${reply.author.name}`}
                                    onClick={() => {
                                      setEditingCommentId(null);
                                      setEditBody("");
                                      setError(null);
                                    }}
                                    disabled={mutationBusy}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className={COMMENT_ACTION_CLASS}
                                    aria-label={`Save reply by ${reply.author.name}`}
                                    onClick={() => {
                                      const nextBody = editBody.trim();
                                      if (!nextBody) return;
                                      runMutation(
                                        {
                                          kind: "edit",
                                          commentId: reply.id,
                                        },
                                        () =>
                                          commentsActions.editComment(
                                            documentId,
                                            reply.id,
                                            nextBody,
                                          ),
                                        "Couldn't edit your comment. Please try again.",
                                        () => {
                                          setEditingCommentId(null);
                                          setEditBody("");
                                        },
                                      );
                                    }}
                                    disabled={
                                      mutationBusy ||
                                      editBody.trim().length === 0
                                    }
                                  >
                                    {pendingAction?.kind === "edit" &&
                                    pendingAction.commentId === reply.id
                                      ? "Saving…"
                                      : "Save"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="mt-0.5 whitespace-pre-wrap leading-5 text-ds-text-secondary">
                                  {reply.body}
                                </p>
                                {deletingCommentId === reply.id ? (
                                  <div className="mt-1.5 rounded-md border border-ds-danger-border bg-ds-danger-surface px-2 py-1.5 text-ds-danger-text">
                                    <p className="text-[11px] font-medium">
                                      Delete this reply?
                                    </p>
                                    <div className="mt-1 flex justify-end gap-2">
                                      <button
                                        type="button"
                                        className={COMMENT_ACTION_CLASS}
                                        aria-label={`Cancel deleting reply by ${reply.author.name}`}
                                        onClick={() => {
                                          setDeletingCommentId(null);
                                          setError(null);
                                        }}
                                        disabled={mutationBusy}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className={COMMENT_ACTION_CLASS}
                                        aria-label={`Confirm delete reply by ${reply.author.name}`}
                                        onClick={() =>
                                          runMutation(
                                            {
                                              kind: "delete",
                                              commentId: reply.id,
                                            },
                                            () =>
                                              commentsActions.deleteComment(
                                                documentId,
                                                reply.id,
                                              ),
                                            "Couldn't delete your comment. Please try again.",
                                            () => setDeletingCommentId(null),
                                          )
                                        }
                                        disabled={mutationBusy}
                                      >
                                        {pendingAction?.kind === "delete" &&
                                        pendingAction.commentId === reply.id
                                          ? "Deleting…"
                                          : "Delete"}
                                      </button>
                                    </div>
                                  </div>
                                ) : reply.author.id === currentUserId ? (
                                  <div className="mt-1 flex gap-2">
                                    <button
                                      type="button"
                                      className={COMMENT_ACTION_CLASS}
                                      aria-label={`Edit reply by ${reply.author.name}`}
                                      onClick={() => {
                                        setEditingCommentId(reply.id);
                                        setEditBody(reply.body);
                                        setReplyingToId(null);
                                        setBody("");
                                        setDeletingCommentId(null);
                                        setError(null);
                                      }}
                                      disabled={mutationBusy}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className={COMMENT_ACTION_CLASS}
                                      aria-label={`Delete reply by ${reply.author.name}`}
                                      onClick={() => {
                                        setDeletingCommentId(reply.id);
                                        setEditingCommentId(null);
                                        setEditBody("");
                                        setReplyingToId(null);
                                        setBody("");
                                        setError(null);
                                      }}
                                      disabled={mutationBusy}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="rounded-md bg-ds-surface-base p-1.5">
              <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold text-ds-text-muted">
                <MessageCircle aria-hidden="true" className="h-3 w-3" />
                {replyingToThread
                  ? `Reply to ${replyingToThread.author.name}`
                  : "New comment"}
                {replyingToThread ? (
                  <button
                    type="button"
                    className="ml-auto text-[10px] font-semibold text-ds-accent hover:underline"
                    onClick={() => {
                      setReplyingToId(null);
                      setBody("");
                      setError(null);
                    }}
                    disabled={mutationBusy}
                  >
                    Cancel reply
                  </button>
                ) : null}
              </div>
              <textarea
                aria-label="Inline comment"
                value={body}
                disabled={mutationBusy}
                onChange={(event) => {
                  setBody(event.target.value);
                  setError(null);
                }}
                rows={2}
                maxLength={COMMENT_BODY_MAX_LENGTH}
                placeholder="Add a few words here"
                className={cx(
                  "min-h-16 w-full resize-none px-2 py-1.5",
                  FIELD_CONTROL,
                )}
                autoFocus
              />
            </div>
            {error ? (
              <div
                role="alert"
                className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ds-danger-text"
              >
                <span>{error}</span>
                <button
                  type="button"
                  disabled={mutationBusy}
                  onClick={() => setError(null)}
                  className="rounded-full px-2 py-0.5 font-semibold transition hover:bg-ds-danger-surface disabled:opacity-50"
                >
                  Dismiss error
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-1.5 border-t border-ds-border-subtle bg-ds-surface-raised/60 px-2 py-1.5">
            <Button
              size="sm"
              variant="plain"
              onClick={closeDialog}
              disabled={mutationBusy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="solid"
              leadingIcon={<Send aria-hidden="true" className="h-3.5 w-3.5" />}
              onClick={submit}
              disabled={mutationBusy || body.trim().length === 0}
            >
              {pendingAction?.kind === "create"
                ? replyingToThread
                  ? "Replying…"
                  : "Posting…"
                : replyingToThread
                  ? "Reply"
                  : "Comment"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
