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

import { createComment } from "./comments-actions";
import type { CommentsActionPort } from "@/lib/action-ports";
import type { CommentThread } from "@/lib/comments";
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

const commentsActions: Pick<CommentsActionPort, "createComment"> = {
  createComment,
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
    const key = normalizeInlineAnchorText(thread.anchorText);
    const current = map.get(key) ?? [];
    current.push(thread);
    map.set(key, current);
  }
  return map;
}

export function InlineCommentsLayer({
  documentId,
  initialComments,
}: {
  documentId: string;
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
  const [error, setError] = useState<string | null>(null);
  const [cardPosition, setCardPosition] = useState<CommentCardPosition | null>(
    null,
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const byAnchor = useMemo(() => threadsByTextAnchor(threads), [threads]);

  const closeDialog = useCallback(() => {
    setActiveAnchor(null);
    setBody("");
    setReplyingToId(null);
    setError(null);
  }, []);

  const computeCommentDots = useCallback(() => {
    const root = editor.getRootElement();
    if (!root) {
      return [] as Array<AnchorPosition & { count: number }>;
    }
    const seen = new Set<string>();
    const dots: Array<AnchorPosition & { count: number }> = [];
    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement) || !isTextCommentBlock(child)) {
        continue;
      }
      const position = anchorPositionForBlock(child, root);
      if (!position || seen.has(position.text)) {
        continue;
      }
      const count = (byAnchor.get(position.text) ?? []).filter(
        (thread) => !thread.resolved,
      ).length;
      if (count > 0) {
        seen.add(position.text);
        dots.push({ ...position, count });
      }
    }
    return dots;
  }, [byAnchor, editor]);

  const [commentDots, setCommentDots] = useState<
    Array<AnchorPosition & { count: number }>
  >([]);

  const refreshPositions = useCallback(() => {
    setCommentDots(computeCommentDots());
  }, [computeCommentDots]);

  useEffect(() => {
    const frame = requestAnimationFrame(refreshPositions);
    return () => cancelAnimationFrame(frame);
  }, [refreshPositions, threads]);

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
    setError(null);
    startTransition(async () => {
      try {
        const result = await commentsActions.createComment(
          documentId,
          parentId
            ? { body: trimmed, parentId }
            : {
                body: trimmed,
                anchorType: "text",
                anchorText: anchor.text,
              },
        );
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setThreads(result.data);
        setBody("");
        setReplyingToId(null);
        if (!parentId) {
          setActiveAnchor(null);
          setHoverAnchor(null);
        }
      } catch {
        setError("Couldn't post your comment. Please try again.");
      }
    });
  }, [activeAnchor, body, documentId, replyingToId]);

  const activeThreads = activeAnchor
    ? (byAnchor.get(activeAnchor.text) ?? [])
    : [];
  const replyingToThread =
    activeThreads.find((thread) => thread.id === replyingToId) ?? null;
  const visibleHoverAnchor =
    hoverAnchor &&
    (byAnchor.get(hoverAnchor.text) ?? []).some((thread) => !thread.resolved)
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
          key={dot.text}
          type="button"
          aria-label={`${dot.count} comment${dot.count === 1 ? "" : "s"}`}
          onClick={() => setActiveAnchor(dot)}
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
                      {activeThreads.length} open
                    </div>
                  ) : null}
                </div>
              </div>
              <IconButton
                aria-label="Close inline comment"
                size="sm"
                onClick={closeDialog}
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
                        <span className="font-medium text-ds-text-primary">
                          {thread.author.name}
                        </span>
                        <p className="mt-0.5 whitespace-pre-wrap leading-5 text-ds-text-secondary">
                          {thread.body}
                        </p>
                        <button
                          type="button"
                          className="mt-1 text-[11px] font-semibold text-ds-accent hover:underline"
                          aria-label={`Reply to comment by ${thread.author.name}`}
                          onClick={() => {
                            setReplyingToId(thread.id);
                            setBody("");
                            setError(null);
                          }}
                          disabled={isPending}
                        >
                          Reply
                        </button>
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
                            <p className="mt-0.5 whitespace-pre-wrap leading-5 text-ds-text-secondary">
                              {reply.body}
                            </p>
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
                  >
                    Cancel reply
                  </button>
                ) : null}
              </div>
              <textarea
                aria-label="Inline comment"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={2}
                placeholder="Add a few words here"
                className={cx(
                  "min-h-16 w-full resize-none px-2 py-1.5",
                  FIELD_CONTROL,
                )}
                autoFocus
              />
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-xs text-ds-danger-text">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-1.5 border-t border-ds-border-subtle bg-ds-surface-raised/60 px-2 py-1.5">
            <Button size="sm" variant="plain" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="solid"
              leadingIcon={<Send aria-hidden="true" className="h-3.5 w-3.5" />}
              onClick={submit}
              disabled={isPending || body.trim().length === 0}
            >
              {replyingToThread ? "Reply" : "Comment"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
