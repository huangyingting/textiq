import type { DashboardDocument } from "@/lib/document/list";

import {
  DocumentCard,
  type DocumentCardData,
  type DocumentCardUpdate,
} from "./document-card";
import { NewDocumentButton } from "./new-document-button";

const primaryButtonClass =
  "flex h-10 items-center justify-center rounded-full bg-ds-accent px-5 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60";

export function EmptyDocumentList() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-ds-border-strong bg-ds-surface-base px-6 py-16 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-ds-text-primary">
          No documents yet
        </h2>
        <p className="text-sm text-ds-text-secondary">
          Create your first document to start turning text into visuals.
        </p>
      </div>
      <NewDocumentButton className={primaryButtonClass}>
        Create your first document
      </NewDocumentButton>
    </div>
  );
}

export function DocumentGrid({
  visible,
  noTagMatch,
  selectedTagName,
  clearTag,
  noFavorites,
  onDelete,
  onUpdated,
  onRefreshRequested,
}: {
  visible: DashboardDocument[];
  noTagMatch: boolean;
  selectedTagName: string | null;
  clearTag: () => void;
  noFavorites: boolean;
  onDelete: (data: DocumentCardData) => void;
  onUpdated: (id: string, update: DocumentCardUpdate) => void;
  onRefreshRequested: () => void;
}) {
  if (noTagMatch) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ds-border-strong bg-ds-surface-base px-6 py-16 text-center">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-ds-text-primary">
            No documents tagged “{selectedTagName}”
          </h2>
          <p className="text-sm text-ds-text-secondary">
            Try a different tag or clear the filter.
          </p>
        </div>
        <button
          type="button"
          onClick={clearTag}
          className="rounded-full border border-ds-border-strong bg-ds-surface-base px-4 py-2 text-sm font-medium text-ds-text-primary transition hover:bg-ds-surface-sunken"
        >
          Clear filter
        </button>
      </div>
    );
  }

  if (noFavorites) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-ds-border-strong bg-ds-surface-base px-6 py-16 text-center">
        <h2 className="text-base font-medium text-ds-text-primary">
          No favorite documents yet
        </h2>
        <p className="text-sm text-ds-text-secondary">
          Star a document to keep it here for quick access.
        </p>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-ds-border-strong bg-ds-surface-base px-6 py-16 text-center">
        <h2 className="text-base font-medium text-ds-text-primary">
          No documents match your search
        </h2>
        <p className="text-sm text-ds-text-secondary">
          Try different keywords or clear the search. Searches cover titles and
          document content.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map((document) => (
        <DocumentCard
          key={document.id}
          id={document.id}
          title={document.title}
          favorite={document.favorite}
          editedLabel={document.editedLabel}
          workspaceName={document.workspaceName}
          thumbnail={document.thumbnail}
          excerpt={document.excerpt}
          readingMinutes={document.readingMinutes}
          canEdit={document.canEdit}
          canManage={document.canManage}
          onDelete={onDelete}
          onUpdated={onUpdated}
          onRefreshRequested={onRefreshRequested}
        />
      ))}
    </ul>
  );
}
