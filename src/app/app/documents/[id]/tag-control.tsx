"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { DocumentTag } from "@/lib/document/tags";

import { addTag, removeTag } from "./tags-actions";

type TagMutationKind = "add" | "remove";
type TagMutationError = { kind: "add" } | { kind: "remove"; tagId: string };

const ADD_ERROR = "Couldn't add the tag. Please try again.";
const REMOVE_ERROR = "Couldn't remove the tag. Please try again.";

/**
 * Tag editor shown in the document header. Lists the document's tags as chips,
 * lets the user add an existing or new tag (Enter to commit, with an autocomplete
 * datalist of the user's tags), and remove a tag. All mutations go through the
 * access-scoped `addTag`/`removeTag` server actions, which return the document's
 * refreshed tag list so the chips stay in sync across collaborators on reload.
 */
type TagControlProps = {
  documentId: string;
  initialTags: DocumentTag[];
  allTags: DocumentTag[];
  editable?: boolean;
};

export function TagControl(props: TagControlProps) {
  return <TagControlForDocument key={props.documentId} {...props} />;
}

function TagControlForDocument({
  documentId,
  initialTags,
  allTags,
  editable = true,
}: TagControlProps) {
  const [tags, setTags] = useState<DocumentTag[]>(initialTags);
  const [input, setInput] = useState("");
  const [actionError, setActionError] = useState<TagMutationError | null>(null);
  const [pendingKind, setPendingKind] = useState<TagMutationKind | null>(null);
  const mountedRef = useRef(true);
  const mutationIdRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const listId = useId();
  const mutationBusy = pendingKind !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationIdRef.current += 1;
      mutationInFlightRef.current = false;
    };
  }, []);

  // Suggest the user's tags that aren't already on this document.
  const suggestions = allTags.filter(
    (tag) => !tags.some((current) => current.id === tag.id),
  );

  const runMutation = async (
    kind: TagMutationKind,
    failure: TagMutationError,
    mutation: () => Promise<DocumentTag[]>,
  ): Promise<void> => {
    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    const mutationId = ++mutationIdRef.current;
    setActionError(null);
    setPendingKind(kind);
    try {
      const nextTags = await mutation();
      if (!mountedRef.current || mutationIdRef.current !== mutationId) return;
      setTags(nextTags);
      if (kind === "add") setInput("");
    } catch (error) {
      unstable_rethrow(error);
      if (!mountedRef.current || mutationIdRef.current !== mutationId) return;
      setActionError(failure);
    } finally {
      if (mountedRef.current && mutationIdRef.current === mutationId) {
        mutationInFlightRef.current = false;
        setPendingKind(null);
      }
    }
  };

  const handleAdd = async (): Promise<void> => {
    const name = input.trim();
    if (!name) return;
    await runMutation("add", { kind: "add" }, () => addTag(documentId, name));
  };

  const handleRemove = async (tagId: string): Promise<void> => {
    await runMutation("remove", { kind: "remove", tagId }, () =>
      removeTag(documentId, tagId),
    );
  };

  const chipClass =
    "inline-flex items-center gap-1 rounded-full bg-ds-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ds-text-secondary";

  return (
    <div
      role="group"
      aria-label="Tags"
      aria-busy={mutationBusy}
      className="flex flex-wrap items-center gap-1.5 text-ds-text-primary"
    >
      {tags.map((tag) => (
        <span key={tag.id} className={chipClass}>
          {tag.name}
          {editable && (
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              onClick={() => handleRemove(tag.id)}
              disabled={mutationBusy}
              className="-mr-0.5 rounded-full px-0.5 text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary"
            >
              ×
            </button>
          )}
        </span>
      ))}

      {editable && (
        <>
          <input
            aria-label="Add a tag"
            list={listId}
            value={input}
            disabled={mutationBusy}
            aria-invalid={actionError?.kind === "add"}
            onChange={(event) => {
              setInput(event.target.value);
              if (actionError?.kind === "add") setActionError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                return handleAdd();
              }
            }}
            onBlur={handleAdd}
            placeholder={tags.length ? "Add tag…" : "Add a tag…"}
            className="w-24 rounded-full border border-ds-border-strong bg-transparent px-2.5 py-0.5 text-xs text-ds-text-primary outline-none placeholder:text-ds-text-secondary/70 focus:border-ds-accent focus:ring-1 focus:ring-ds-accent/30"
          />
          <datalist id={listId}>
            {suggestions.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
        </>
      )}

      {mutationBusy ? (
        <span role="status" className="text-xs text-ds-text-muted">
          {pendingKind === "add" ? "Adding tag…" : "Removing tag…"}
        </span>
      ) : null}

      {actionError ? (
        <span
          role="alert"
          className="inline-flex flex-wrap items-center gap-1.5 text-xs text-ds-danger-text"
        >
          <span>{actionError.kind === "add" ? ADD_ERROR : REMOVE_ERROR}</span>
          <button
            type="button"
            disabled={mutationBusy}
            onClick={() => {
              if (actionError.kind === "add") return handleAdd();
              return handleRemove(actionError.tagId);
            }}
            className="rounded-full border border-ds-danger-border px-2 py-0.5 font-medium transition hover:bg-ds-danger-surface disabled:opacity-50"
          >
            {actionError.kind === "add" ? "Try add again" : "Try remove again"}
          </button>
          <button
            type="button"
            disabled={mutationBusy}
            onClick={() => setActionError(null)}
            className="rounded-full px-2 py-0.5 font-medium transition hover:bg-ds-state-hover disabled:opacity-50"
          >
            Dismiss error
          </button>
        </span>
      ) : null}
    </div>
  );
}
