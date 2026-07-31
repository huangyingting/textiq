"use client";

import { useId, useState, useTransition } from "react";

import type { DocumentTag } from "@/lib/document/tags";

import { addTag, removeTag } from "./tags-actions";

/**
 * Tag editor shown in the document header. Lists the document's tags as chips,
 * lets the user add an existing or new tag (Enter to commit, with an autocomplete
 * datalist of the user's tags), and remove a tag. All mutations go through the
 * access-scoped `addTag`/`removeTag` server actions, which return the document's
 * refreshed tag list so the chips stay in sync across collaborators on reload.
 */
export function TagControl({
  documentId,
  initialTags,
  allTags,
  editable = true,
}: {
  documentId: string;
  initialTags: DocumentTag[];
  allTags: DocumentTag[];
  editable?: boolean;
}) {
  const [tags, setTags] = useState<DocumentTag[]>(initialTags);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const listId = useId();

  // Suggest the user's tags that aren't already on this document.
  const suggestions = allTags.filter(
    (tag) => !tags.some((current) => current.id === tag.id),
  );

  const handleAdd = () => {
    const name = input.trim();
    if (!name) {
      return;
    }
    setInput("");
    setError(null);
    startTransition(async () => {
      try {
        setTags(await addTag(documentId, name));
      } catch {
        setError("Couldn't add tag");
      }
    });
  };

  const handleRemove = (tagId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        setTags(await removeTag(documentId, tagId));
      } catch {
        setError("Couldn't remove tag");
      }
    });
  };

  const chipClass =
    "inline-flex items-center gap-1 rounded-full bg-ds-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ds-text-secondary";

  return (
    <div
      role="group"
      aria-label="Tags"
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
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
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

      {error && (
        <span role="alert" className="text-xs text-ds-danger">
          {error}
        </span>
      )}
    </div>
  );
}
