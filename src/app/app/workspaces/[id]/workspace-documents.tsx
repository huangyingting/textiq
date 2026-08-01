"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { FileText, Plus, Upload } from "lucide-react";

import { Button, EMPTY_STATE_CHROME, PANEL_CHROME, cx } from "@/components/ui";
import { TemplatePickerDialog } from "@/components/template-picker-dialog";
import { capabilitiesForWorkspaceAccessRole } from "@/lib/workspace/capabilities";
import type { EffectiveWorkspaceRole } from "@/lib/workspace/roles";
import {
  DOCUMENT_IMPORT_ACCEPT,
  useDocumentImportCreationWorkflow,
} from "@/lib/import/document-import-workflow";

import { createWorkspaceDocument, getWorkspaceDocuments } from "./actions";
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

export async function resolveWorkspaceDocumentsLoad(workspaceId: string) {
  try {
    return {
      ok: true as const,
      data: await getWorkspaceDocuments(workspaceId),
    };
  } catch (loadError) {
    unstable_rethrow(loadError);
    return { ok: false as const };
  }
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
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const { inputRef, state, isUploading, processFile, clearError } =
    useDocumentImportCreationWorkflow({
      surface: "workspace",
      target: { kind: "workspace", workspaceId },
      onCreated: ({ documentPath }) => {
        router.push(documentPath);
      },
    });

  if (!canCreate && !canImport) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCreate && (
        <Button
          ref={createTriggerRef}
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
            disabled={isUploading}
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
            aria-busy={isUploading}
            onClick={() => {
              clearError();
              inputRef.current?.click();
            }}
            aria-label="Import document"
            leadingIcon={<Upload aria-hidden="true" className="h-4 w-4" />}
          >
            {isUploading ? "Importing…" : "Import"}
          </Button>
          {isUploading ? (
            <p role="status" aria-live="polite" className="sr-only">
              Importing document…
            </p>
          ) : null}
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
        <TemplatePickerDialog
          onChoose={(templateId) =>
            createWorkspaceDocument(workspaceId, templateId)
          }
          onClose={() => setCreateOpen(false)}
          restoreFocusRef={createTriggerRef}
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
  return (
    <WorkspaceDocumentsForWorkspace
      key={workspaceId}
      workspaceId={workspaceId}
      userRole={userRole}
    />
  );
}

function WorkspaceDocumentsForWorkspace({
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
    resolveWorkspaceDocumentsLoad(workspaceId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError("Could not load documents. Please try again.");
        setLoading(false);
        return;
      }
      setDocuments(result.data.documents);
      setHasMore(result.data.hasMore);
      setLoading(false);
      setError(null);
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
