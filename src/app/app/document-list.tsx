"use client";

import {
  unstable_rethrow,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";

import type {
  AvailableTag,
  DashboardDocument,
  SearchResult,
} from "@/lib/document/list";
import type { DocumentListActionPort } from "@/lib/action-ports";

import { deleteDocument, restoreDocument, searchDocuments } from "./actions";
import { DocumentGrid, EmptyDocumentList } from "./document-grid";
import type { DocumentCardUpdate } from "./document-card";
import { DocumentListToolbar } from "./document-list-toolbar";
import { UndoToast } from "./document-list-undo-toast";
import {
  applyDocumentListViewState,
  filterDocumentsByTag,
  filterDocumentsByView,
  parseTag,
  parseSort,
  parseView,
  replaceDocumentListQueryState,
  type SortKey,
  type ViewKey,
} from "./document-list-url-state";
import {
  isCurrentDocumentListRequest,
  nextDocumentListRequestSeq,
} from "./document-list-async-ordering";
import { useOptimisticDocumentTrash } from "./use-optimistic-document-trash";

const SEARCH_DEBOUNCE_MS = 300;
const documentListActions: Pick<
  DocumentListActionPort,
  "deleteDocument" | "restoreDocument" | "searchDocuments"
> = {
  deleteDocument,
  restoreDocument,
  searchDocuments,
};

/**
 * Renders the dashboard document list. Server data stays capped by the
 * document list service; this component owns only client view state,
 * debounced search, and optimistic trash/undo UX.
 */
export function DocumentList({
  documents,
  availableTags,
  listCapped = false,
}: {
  documents: DashboardDocument[];
  availableTags: AvailableTag[];
  listCapped?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    DashboardDocument[] | null
  >(null);
  const [searchCapped, setSearchCapped] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchPending, startSearchTransition] = useTransition();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);
  const inFlightSearchRef = useRef<{
    query: string;
    requestSeq: number;
  } | null>(null);

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sort = parseSort(searchParams.get("sort"));
  const view = parseView(searchParams.get("view"));
  const viewFavorites = view === "favorites";
  const selectedTag = parseTag(searchParams.get("tag"), availableTags);
  const selectedTagName =
    availableTags.find((tag) => tag.slug === selectedTag)?.name ?? null;

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    replaceDocumentListQueryState(pathname, searchParams, mutate);
  };

  const handleQueryChange = (nextQuery: string) => {
    if (nextQuery.trim() !== query.trim()) {
      inFlightSearchRef.current = null;
    }
    setQuery(nextQuery);
    setSearchError(null);
    if (!nextQuery.trim()) {
      searchRequestSeqRef.current = nextDocumentListRequestSeq(
        searchRequestSeqRef.current,
      );
      setSearchResults(null);
      setSearchCapped(false);
    }
  };

  const executeSearch = useCallback(
    (trimmed: string) => {
      if (inFlightSearchRef.current?.query === trimmed) return;

      const requestSeq = nextDocumentListRequestSeq(
        searchRequestSeqRef.current,
      );
      searchRequestSeqRef.current = requestSeq;
      inFlightSearchRef.current = { query: trimmed, requestSeq };
      startSearchTransition(async () => {
        try {
          const { results, hasMore } =
            await documentListActions.searchDocuments(trimmed);
          if (
            !isCurrentDocumentListRequest(
              searchRequestSeqRef.current,
              requestSeq,
            )
          ) {
            return;
          }
          setSearchError(null);
          setSearchCapped(hasMore);
          setSearchResults(
            results.map((result: SearchResult) => ({
              id: result.id,
              title: result.title,
              favorite: result.favorite,
              editedLabel: result.editedLabel,
              workspaceName: result.workspaceName,
              thumbnail: result.thumbnail,
              excerpt: result.excerpt,
              readingMinutes: result.readingMinutes,
              createdAtMs: result.createdAtMs,
              updatedAtMs: result.updatedAtMs,
              canEdit: result.canEdit,
              canManage: result.canManage,
              tags: result.tags,
            })),
          );
        } catch (error) {
          unstable_rethrow(error);
          if (
            !isCurrentDocumentListRequest(
              searchRequestSeqRef.current,
              requestSeq,
            )
          ) {
            return;
          }
          setSearchCapped(false);
          setSearchResults([]);
          setSearchError("Could not search documents. Please try again.");
        } finally {
          if (inFlightSearchRef.current?.requestSeq === requestSeq) {
            inFlightSearchRef.current = null;
          }
        }
      });
    },
    [startSearchTransition],
  );

  const setSort = (next: SortKey) => {
    updateParams((params) => {
      if (next === "edited") {
        params.delete("sort");
      } else {
        params.set("sort", next);
      }
    });
  };

  const setView = (next: ViewKey) => {
    updateParams((params) => {
      if (next === "all") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
    });
  };

  const setTag = (next: string | null) => {
    updateParams((params) => {
      if (!next) {
        params.delete("tag");
      } else {
        params.set("tag", next);
      }
    });
  };

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    const trimmed = query.trim();
    searchRequestSeqRef.current = nextDocumentListRequestSeq(
      searchRequestSeqRef.current,
    );
    if (!trimmed) {
      searchDebounceRef.current = null;
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      executeSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [executeSearch, query]);

  const {
    combinedDocuments,
    removedIds,
    undo,
    errorMessage: trashErrorMessage,
    handleDelete,
    handleUndo,
  } = useOptimisticDocumentTrash(documents, documentListActions);

  const trimmedQuery = query.trim();
  const activePool: DashboardDocument[] = trimmedQuery
    ? (searchResults ?? []).filter((document) => !removedIds.has(document.id))
    : combinedDocuments;

  const visible = applyDocumentListViewState(activePool, {
    sort,
    view,
    tagSlug: selectedTag,
  });
  const tagFiltered = filterDocumentsByTag(activePool, selectedTag);
  const favFiltered = filterDocumentsByView(tagFiltered, view);

  const hasDocuments = combinedDocuments.length > 0;
  const noTagMatch = selectedTag !== null && tagFiltered.length === 0;
  const noFavorites = viewFavorites && favFiltered.length === 0;
  const isSearching = isSearchPending && Boolean(trimmedQuery);
  const capActive = trimmedQuery ? searchCapped : listCapped;
  const showCapNotice = capActive && visible.length > 0;
  const handleDocumentUpdated = useCallback(
    (id: string, update: DocumentCardUpdate) => {
      setSearchResults((current) =>
        current
          ? current.map((document) =>
              document.id === id ? { ...document, ...update } : document,
            )
          : current,
      );
    },
    [],
  );
  const refreshActiveSearch = useCallback(() => {
    if (trimmedQuery) executeSearch(trimmedQuery);
  }, [executeSearch, trimmedQuery]);

  return (
    <>
      {!hasDocuments ? (
        <EmptyDocumentList />
      ) : (
        <div className="flex flex-col gap-6">
          <DocumentListToolbar
            availableTags={availableTags}
            query={query}
            setQuery={handleQueryChange}
            isSearching={isSearching}
            selectedTag={selectedTag}
            setTag={setTag}
            sort={sort}
            setSort={setSort}
            view={view}
            setView={setView}
          />

          {showCapNotice && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border border-ds-border-subtle bg-ds-surface-sunken px-4 py-2 text-sm text-ds-text-secondary"
            >
              Showing the first {visible.length} documents — narrow your search
              to see more.
            </p>
          )}
          {trashErrorMessage && (
            <p
              role="alert"
              className="rounded-lg border border-ds-danger-border bg-ds-danger-surface px-4 py-2 text-sm text-ds-danger-text"
            >
              {trashErrorMessage}
            </p>
          )}
          {searchError && (
            <div
              role="alert"
              className="rounded-lg border border-ds-danger-border bg-ds-danger-surface px-4 py-3 text-sm text-ds-danger-text"
            >
              <p>{searchError}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={isSearchPending}
                  onClick={() => {
                    if (!trimmedQuery) return;
                    setSearchError(null);
                    executeSearch(trimmedQuery);
                  }}
                >
                  Try search again
                </Button>
                <Button
                  variant="plain"
                  size="sm"
                  disabled={isSearchPending}
                  onClick={() => setSearchError(null)}
                >
                  Dismiss error
                </Button>
              </div>
            </div>
          )}

          <DocumentGrid
            visible={visible}
            noTagMatch={noTagMatch}
            selectedTagName={selectedTagName}
            clearTag={() => setTag(null)}
            noFavorites={noFavorites}
            onDelete={handleDelete}
            onUpdated={handleDocumentUpdated}
            onRefreshRequested={refreshActiveSearch}
          />
        </div>
      )}

      {undo && <UndoToast title={undo.title} onUndo={handleUndo} />}
    </>
  );
}
