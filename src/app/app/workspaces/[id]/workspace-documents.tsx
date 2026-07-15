"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { FileText, Plus, Upload, X } from "lucide-react";

import {
  Button,
  Dialog,
  EMPTY_STATE_CHROME,
  IconButton,
  PANEL_CHROME,
  cx,
} from "@/components/ui";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";
import { capabilitiesForWorkspaceAccessRole } from "@/lib/workspace/capabilities";
import type { EffectiveWorkspaceRole } from "@/lib/workspace/roles";
import {
  DOCUMENT_IMPORT_ACCEPT,
  useDocumentImportWorkflow,
} from "@/lib/import/document-import-workflow";

import {
  createWorkspaceDocument,
  importWorkspaceDocument,
  getWorkspaceDocuments,
} from "./actions";
import type { WorkspaceDocument } from "@/lib/workspace/document-types";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function DocumentThumbnail() {
  return (
    <div className="flex aspect-[16/10] items-center justify-center bg-ds-surface-sunken transition group-hover:bg-ds-state-hover">
      <FileText aria-hidden="true" className="h-8 w-8 text-ds-text-muted" />
    </div>
  );
}

/** Template picker dialog for creating workspace documents. */
function WorkspaceTemplatePicker({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const choose = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await createWorkspaceDocument(workspaceId, id);
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="ws-template-picker-title"
      className="flex max-h-[85vh] flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="ws-template-picker-title"
            className="text-base font-semibold text-ds-text-primary"
          >
            New document
          </h2>
          <p className="mt-1 text-sm text-ds-text-secondary">
            Choose a template to get started.
          </p>
        </div>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          size="md"
          className="shrink-0"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </IconButton>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {TEMPLATE_CATALOG.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              aria-label={`${template.name} template`}
              disabled={isPending}
              onClick={() => choose(template.id)}
              className={cx(
                "flex h-full w-full flex-col gap-1 p-4 text-left transition hover:border-ds-accent-border hover:bg-ds-surface-sunken disabled:cursor-not-allowed disabled:opacity-60",
                PANEL_CHROME,
              )}
            >
              <span className="text-sm font-medium text-ds-text-primary">
                {pendingId === template.id ? "Creating…" : template.name}
              </span>
              <span className="text-xs text-ds-text-secondary">
                {template.description}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-end">
        <Button variant="subtle" size="lg" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/** Toolbar with New and Import buttons for owners and editors. */
function WorkspaceDocumentActions({
  workspaceId,
  canCreate,
  canImport,
}: {
  workspaceId: string;
  canCreate: boolean;
  canImport: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [, startTransition] = useTransition();
  const { inputRef, state, isUploading, processFile, clearError } =
    useDocumentImportWorkflow({
      surface: "workspace",
      onImported: ({ markdown, title }) => {
        startTransition(async () => {
          await importWorkspaceDocument(workspaceId, markdown, title);
        });
      },
    });

  if (!canCreate && !canImport) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCreate && (
        <Button
          variant="solid"
          size="lg"
          leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
          onClick={() => setCreateOpen(true)}
        >
          New document
        </Button>
      )}

      {canImport && (
        <div className="flex flex-col items-end gap-1">
          <input
            ref={inputRef}
            type="file"
            accept={DOCUMENT_IMPORT_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processFile(file);
              e.target.value = "";
            }}
            className="sr-only"
            aria-label="Import a document file into workspace"
          />
          <Button
            variant="subtle"
            size="lg"
            disabled={isUploading}
            onClick={() => {
              clearError();
              inputRef.current?.click();
            }}
            aria-label="Import document"
            leadingIcon={<Upload aria-hidden="true" className="h-4 w-4" />}
          >
            {isUploading ? "Importing…" : "Import"}
          </Button>
          {state.status === "error" && (
            <p role="alert" className="text-xs text-ds-danger-text">
              {state.message} —{" "}
              <button
                type="button"
                onClick={() => {
                  clearError();
                  inputRef.current?.click();
                }}
                className="underline"
              >
                retry
              </button>
            </p>
          )}
        </div>
      )}

      {createOpen && (
        <WorkspaceTemplatePicker
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

export function WorkspaceDocuments({
  workspaceId,
  userRole,
}: {
  workspaceId: string;
  userRole: EffectiveWorkspaceRole;
}) {
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  const roleCapabilities = capabilitiesForWorkspaceAccessRole(userRole);
  const canCreate = roleCapabilities.canMutate;
  const canImport = roleCapabilities.canMutate;

  const retry = () => {
    setError(null);
    setLoading(true);
    setLoadKey((k) => k + 1);
  };

  useEffect(() => {
    let cancelled = false;
    getWorkspaceDocuments(workspaceId)
      .then((result) => {
        if (cancelled) return;
        setDocuments(result.documents);
        setHasMore(result.hasMore);
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load documents. Please try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, loadKey]);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cx(
          "p-6 text-center text-sm text-ds-text-muted",
          PANEL_CHROME,
        )}
      >
        Loading documents...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className={cx(
          "p-6 text-center text-sm text-ds-text-muted",
          PANEL_CHROME,
        )}
      >
        <p>{error}</p>
        <Button
          variant="subtle"
          size="lg"
          onClick={retry}
          className="mx-auto mt-3"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <WorkspaceDocumentActions
          workspaceId={workspaceId}
          canCreate={canCreate}
          canImport={canImport}
        />
        <div className={cx("p-6", EMPTY_STATE_CHROME)}>
          <p className="text-sm text-ds-text-muted">
            No documents in this workspace yet.
            {canCreate && " Create or import one to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <WorkspaceDocumentActions
        workspaceId={workspaceId}
        canCreate={canCreate}
        canImport={canImport}
      />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              href={`/app/documents/${document.id}`}
              className={cx(
                "group flex flex-col overflow-hidden transition hover:border-ds-border-strong hover:shadow-ds-raised",
                PANEL_CHROME,
              )}
            >
              <DocumentThumbnail />
              <div className="flex flex-col gap-1 p-4">
                <span className="truncate text-sm font-medium text-ds-text-primary">
                  {document.title}
                </span>
                <span className="text-xs text-ds-text-muted">
                  Edited {dateFormatter.format(new Date(document.updatedAt))}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-xs text-ds-text-muted"
        >
          Showing the first {documents.length} documents in this workspace.
        </p>
      )}
    </div>
  );
}
