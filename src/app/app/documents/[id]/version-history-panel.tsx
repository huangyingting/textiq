"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { History as HistoryIcon } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

import {
  EditorSidePanel,
  EditorSidePanelHeaderButton,
} from "@/components/editor/side-panel";
import { EditorToolbarButton } from "@/components/editor/toolbar-button";

import { listDocumentVersions, restoreDocumentVersion } from "./actions";
import type { DocumentVersionSummary } from "@/lib/document/persistence-types";
import { RESTORE_TAG } from "@/lib/content";

type HistoryActionKind = "load" | "restore";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Version History panel for the editor chrome (issue #158). Lists a document's
 * saved snapshots newest-first and lets an editor restore one. Mounted from
 * `lexical-editor.tsx`; lazily loads versions when first opened.
 *
 * Restore writes the chosen snapshot back as the current document state (after
 * checkpointing the pre-restore state server-side) and reloads so the
 * collaborative editor re-seeds from the restored content.
 */
export function VersionHistoryPanel({
  documentId,
  canEdit,
  iconOnly = false,
}: {
  documentId: string;
  canEdit: boolean;
  iconOnly?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<HistoryActionKind | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const actionInFlightRef = useRef(false);
  const actionKindRef = useRef<HistoryActionKind | null>(null);
  const mutationBusy = isPending || pendingKind !== null;
  const restoreBusy = pendingKind === "restore";

  const refresh = useCallback(() => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    actionKindRef.current = "load";
    setError(null);
    setPendingKind("load");
    startTransition(async () => {
      try {
        setVersions(await listDocumentVersions(documentId));
        setLoaded(true);
      } catch (error) {
        unstable_rethrow(error);
        setError("Couldn't load version history. Please try again.");
      } finally {
        actionInFlightRef.current = false;
        actionKindRef.current = null;
        setPendingKind(null);
      }
    });
  }, [documentId]);

  const toggleOpen = useCallback(() => {
    if (open) {
      if (actionKindRef.current === "restore") return;
      setOpen(false);
      return;
    }

    if (!loaded) refresh();
    setOpen(true);
  }, [loaded, open, refresh]);

  const restore = useCallback(
    (versionId: string) => {
      if (actionInFlightRef.current) return;

      actionInFlightRef.current = true;
      actionKindRef.current = "restore";
      setError(null);
      setPendingKind("restore");
      startTransition(async () => {
        try {
          const res = await restoreDocumentVersion(versionId);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          const restoredState = editor.parseEditorState(
            JSON.stringify(res.data.contentJson),
          );
          editor.setEditorState(restoredState, { tag: RESTORE_TAG });
          setConfirmId(null);
          setOpen(false);
        } catch (error) {
          unstable_rethrow(error);
          setError("Couldn't restore this version. Please try again.");
        } finally {
          actionInFlightRef.current = false;
          actionKindRef.current = null;
          setPendingKind(null);
        }
      });
    },
    [editor],
  );

  return (
    <>
      <EditorToolbarButton
        label="History"
        tooltip="Version history"
        icon={<HistoryIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        iconOnly={iconOnly}
        onClick={toggleOpen}
        disabled={restoreBusy}
        aria-label="Version history"
        aria-expanded={open}
      />

      {open ? (
        <EditorSidePanel
          label="Version history"
          title="Version history"
          busy={mutationBusy}
          actions={
            <>
              <EditorSidePanelHeaderButton
                onClick={refresh}
                disabled={mutationBusy}
                aria-label="Refresh version history"
              >
                Refresh
              </EditorSidePanelHeaderButton>
              <EditorSidePanelHeaderButton
                onClick={toggleOpen}
                disabled={restoreBusy}
                aria-label="Close version history"
                className="text-sm"
              >
                ✕
              </EditorSidePanelHeaderButton>
            </>
          }
        >
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {error ? (
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ds-danger-text"
              >
                <span>{error}</span>
                <button
                  type="button"
                  disabled={mutationBusy}
                  onClick={() => setError(null)}
                  className="rounded-full px-2 py-0.5 font-medium transition hover:bg-ds-danger-surface disabled:opacity-50"
                >
                  Dismiss error
                </button>
              </div>
            ) : null}

            {loaded && versions.length === 0 && !mutationBusy ? (
              <p className="text-sm text-ds-text-muted">
                No saved versions yet. Snapshots are captured periodically as
                you edit.
              </p>
            ) : null}

            {!loaded && mutationBusy ? (
              <p className="text-sm text-ds-text-muted">Loading…</p>
            ) : null}

            <ul className="flex flex-col gap-2">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="rounded-lg border border-ds-border-subtle bg-ds-surface-raised px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ds-text-primary">
                        {formatTime(version.createdAt)}
                      </p>
                      <p className="truncate text-xs text-ds-text-muted">
                        {version.label ? `${version.label} · ` : ""}
                        {version.authorName ?? "Unknown"}
                        {version.hasDeck ? " · deck" : ""}
                      </p>
                    </div>
                    {canEdit ? (
                      confirmId === version.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => restore(version.id)}
                            disabled={mutationBusy}
                            aria-label={
                              error ? "Try restore again" : "Confirm restore"
                            }
                            className="rounded-full bg-ds-control px-2.5 py-1 text-xs font-medium text-ds-control-text transition hover:bg-ds-control-hover disabled:opacity-50"
                          >
                            {restoreBusy
                              ? "Restoring…"
                              : error
                                ? "Try again"
                                : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            disabled={mutationBusy}
                            aria-label="Cancel restore"
                            className="rounded-full border border-ds-border-subtle px-2.5 py-1 text-xs font-medium text-ds-text-secondary transition hover:text-ds-text-primary disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setConfirmId(version.id);
                          }}
                          disabled={mutationBusy}
                          aria-label="Restore this version"
                          className="shrink-0 rounded-full border border-ds-border-subtle px-2.5 py-1 text-xs font-medium text-ds-text-secondary transition hover:border-ds-border-strong hover:text-ds-text-primary disabled:opacity-50"
                        >
                          Restore
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </EditorSidePanel>
      ) : null}
    </>
  );
}
