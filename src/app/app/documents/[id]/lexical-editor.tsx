"use client";

import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalCollaboration } from "@lexical/react/LexicalCollaborationContext";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorThemeClasses, Klass, LexicalNode } from "lexical";
import { LayoutPanelLeft, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLexicalCollaboration } from "@/lib/collab/use-lexical-collaboration";
import { useYText } from "@/lib/collab/use-collaboration";
import type { DocumentEditorViewModel } from "@/lib/document-editor/view-model";
import { readingTimeMinutes, wordCount } from "@/lib/document-stats";
import { createEditorPlugin, EditorPluginHost } from "@/lib/lexical/editor-api";
import { EditorContextProvider } from "@/lib/lexical/editor-context";
import { createCoreEditorPlugins } from "@/lib/lexical/editor-plugins";
import { shouldAutosaveUpdate } from "@/lib/content";
import { ensureLexicalBlockIdSupport } from "@/lib/lexical/block-id-runtime";
import { useLexicalAutosave } from "@/lib/lexical/use-autosave";
import { useCollaborationEditable } from "@/lib/lexical/use-collaboration-gate";
import {
  VisualNode,
  VisualNodeRendererProvider,
  type VisualNodeRendererProps,
} from "@/lib/lexical/visual-node";

import { fetchDeckJson, saveDocumentLexical } from "./actions";
import { BlockSparkPlugin } from "./block-spark";
import { DocumentExportButton } from "@/components/editor/document-export-button";
import { PageBreakIndicator } from "@/components/editor/page-break-indicator";
import { PresentButton } from "@/components/editor/present-button";
import {
  EditorToolbarButton,
  EditorToolbarDivider,
  EditorToolbarGroup,
} from "@/components/editor/toolbar-button";
import { VisualSvgRegistryProvider } from "@/components/editor/visual-svg-registry";
import { Popover, cx } from "@/components/ui";
import { FloatingTextToolbar } from "./floating-text-toolbar";
import { ImportPlugin } from "./import-plugin";
import { InsertMenuPlugin } from "./insert-menu";
import { InsertVisualPlugin } from "./insert-visual-plugin";
import { InlineCommentsLayer } from "./inline-comments-layer";
import { MobileEditingSheetHost } from "./mobile-editing-sheet";
import { Presence } from "./presence";
import { OverallAdjustmentsPanel } from "./overall-adjustments-panel";
import { ShareButton } from "./share-button";
import { SourceBlockJumpPlugin } from "./source-block-jump";
import { TagControl } from "./tag-control";
import { TableControls } from "./table-controls";
import { UndoRedoControls } from "./undo-redo-controls";
import { VersionHistoryPanel } from "./version-history-panel";
import { VisualCard } from "./visual-card";
import { VisualPanelProvider } from "./visual-panel-context";
import { RightSurfaceProvider } from "./right-surface-context";

const theme: EditorThemeClasses = {
  paragraph: "mb-3 leading-7",
  heading: {
    h1: "mb-3 mt-2 text-3xl font-semibold tracking-tight",
    h2: "mb-3 mt-2 text-2xl font-semibold tracking-tight",
    h3: "mb-2 mt-2 text-xl font-semibold tracking-tight",
  },
  quote: "mb-3 border-l-4 border-ds-border-strong pl-4 italic",
  hr: "my-6 border-0 border-t border-ds-border-strong",
  visual: "my-2",
  link: "text-ds-accent-text underline underline-offset-2",
  table: "my-4 w-full border-collapse overflow-hidden rounded-ds-md text-sm",
  tableCell: "border border-ds-border-subtle px-2 py-1.5 align-top leading-6",
  tableCellHeader:
    "border border-ds-border-subtle bg-ds-surface-raised px-2 py-1.5 text-left font-semibold leading-6",
  tableRow: "align-top",
  list: {
    ul: "mb-3 ml-6 list-disc",
    ol: "mb-3 ml-6 list-decimal",
    listitem: "leading-7",
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded-ds-sm border border-ds-border-subtle bg-ds-surface-sunken px-1 py-0.5 font-mono text-[0.9em] text-ds-text-secondary",
  },
};

// Nodes the editor can render/parse. Headings and lists are required so that
// imported Markdown round-trips through Lexical's `parseEditorState`.
const NODES: Array<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
  VisualNode,
];

ensureLexicalBlockIdSupport();

function onError(error: Error) {
  console.error(error);
}

const STATUS_LABEL = {
  saved: "All changes saved",
  pending: "Unsaved changes…",
  saving: "Saving…",
  error: "Couldn't save changes",
} as const;

function DocumentStyleButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      aria-label="Document style"
      className="w-80 overflow-hidden p-0"
      trigger={
        <EditorToolbarButton
          label="Style"
          tooltip="Document style"
          icon={
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          }
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
        />
      }
    >
      <OverallAdjustmentsPanel />
    </Popover>
  );
}

function RoutedPresentButton({
  documentId,
  documentTitle,
}: {
  documentId: string;
  documentTitle: string;
}) {
  const deckPort = useMemo(() => ({ fetchDeckJson }), []);
  return (
    <PresentButton
      documentId={documentId}
      deckPort={deckPort}
      documentTitle={documentTitle}
    />
  );
}

function RoutedDocumentExportButton({
  documentId,
  initialDeckJson,
  documentTitle,
}: {
  documentId: string;
  initialDeckJson: unknown;
  documentTitle: string;
}) {
  const deckPort = useMemo(() => ({ fetchDeckJson }), []);
  return (
    <DocumentExportButton
      documentTitle={documentTitle}
      documentId={documentId}
      deckPort={deckPort}
      initialDeckJson={initialDeckJson}
    />
  );
}

function PageGuidesButton({
  showPageBreaks,
  onToggle,
}: {
  showPageBreaks: boolean;
  onToggle: () => void;
}) {
  const label = showPageBreaks ? "Hide page-break guides" : "Page guides";

  return (
    <EditorToolbarButton
      label={label}
      tooltip={
        showPageBreaks
          ? "Hide page-break guides"
          : "Show page-break guides (A4)"
      }
      active={showPageBreaks}
      aria-pressed={showPageBreaks}
      onClick={onToggle}
      icon={
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M2 5h12M2 11h12" />
        </svg>
      }
    />
  );
}

type EditorHeaderMode = "full" | "compact" | "stacked";

function useEditorHeaderMode() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<EditorHeaderMode>("stacked");

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      const width = element.getBoundingClientRect().width;
      setMode(width >= 980 ? "full" : width >= 680 ? "compact" : "stacked");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, mode };
}

/**
 * The document editor: a Lexical block editor bound to a document with real-time
 * collaboration. Content lives in a shared Yjs document synced over the collab
 * websocket server; the `CollaborationPlugin` bootstraps it from the serialized
 * `initialStateJson` (the DB is the durable source of truth — the collab server
 * holds no persistent state). Local edits are persisted via the debounced
 * `saveDocumentLexical` action; remote/CRDT merges do not re-save (only the
 * originator writes). The title is a separate collaborative, autosaved input.
 * It renders the full document chrome (back link, workspace, read-only badge,
 * presence, sharing, inline comments) and hosts the "+"/"/" insert menus, the floating
 * format toolbar, the per-block visual spark, and inline visual cards.
 */
export function LexicalEditor({
  documentId,
  initialTitle,
  initialStateJson = null,
  initialDeckJson = null,
  userId: _userId,
  userName,
  canEdit = true,
  canManage = false,
  workspaceName,
  initialComments = [],
  initialIsShared = false,
  initialShareId = null,
  initialSlug = null,
  initialShareExpiresAt = null,
  initialShareEmbedEnabled = true,
  initialSharePresentEnabled = true,
  initialShareMetadataMode = "generic",
  initialShareDiscoverable = false,
  initialTags = [],
  allTags = [],
}: Partial<
  Pick<
    DocumentEditorViewModel,
    | "initialStateJson"
    | "initialDeckJson"
    | "canEdit"
    | "canManage"
    | "workspaceName"
    | "initialComments"
    | "initialIsShared"
    | "initialShareId"
    | "initialSlug"
    | "initialShareExpiresAt"
    | "initialShareEmbedEnabled"
    | "initialSharePresentEnabled"
    | "initialShareMetadataMode"
    | "initialShareDiscoverable"
    | "initialTags"
    | "allTags"
  >
> &
  Pick<
    DocumentEditorViewModel,
    "documentId" | "initialTitle" | "userId" | "userName"
  >) {
  const collab = useLexicalCollaboration({ room: documentId, userName });

  // Editing is enabled only with permission AND once collaboration is ready
  // (synced, or a degraded local-only fallback), so no one edits before the
  // shared document is bootstrapped from the database.
  const editable = useCollaborationEditable(canEdit, collab.ready);

  // Ref for the editor content area — used by PageBreakIndicator.
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  // Page break indicators are shown by default at A4 size and can be toggled off.
  const [showPageBreaks, setShowPageBreaks] = useState(false);

  // Collaborative document title. The editor chrome consumes it as compact
  // identity; renaming is handled from the document-level surfaces outside this
  // editor, so the header does not expose a second title editor.
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const title = useYText(collab.ytitle, {
    initial: initialTitle,
    ready: collab.ready,
    editable: false,
    localOrigin: collab.localOrigin,
    elementRef: titleInputRef,
  });

  // Seed the title into the shared room from the database once ready.
  useEffect(() => {
    if (collab.ready) {
      collab.seedTitle(initialTitle);
    }
  }, [collab, initialTitle]);

  // Live document text, for reading time / word count (US-024). Updated on every
  // editor change (local and remote) by `DocumentStatsPlugin`.
  const [statsText, setStatsText] = useState("");
  const handleStatsText = useCallback((text: string) => setStatsText(text), []);
  const words = wordCount(statsText);
  const minutes = readingTimeMinutes(statsText);

  const saveLexical = useCallback(
    (json: string) => saveDocumentLexical(documentId, json),
    [documentId],
  );
  const { status, handleChange } = useLexicalAutosave({
    save: saveLexical,
    shouldAutosaveUpdate,
  });

  const initialConfig = {
    namespace: "TextIQLexicalEditor",
    theme,
    nodes: NODES,
    onError,
    // Collaboration provides the document state (bootstrapped from the DB), and
    // editing is gated until the room is ready.
    editorState: null,
    editable: false,
  };

  const saveStatus = status;
  const { ref: editorHeaderRef, mode: editorHeaderMode } =
    useEditorHeaderMode();
  const toolbarLabels = editorHeaderMode === "full" ? "show" : "hide";
  const headerStacked = editorHeaderMode === "stacked";
  const headerFull = editorHeaderMode === "full";
  const corePlugins = useMemo(
    () =>
      createCoreEditorPlugins({
        documentId,
        providerFactory: collab.providerFactory,
        initialStateJson,
        userName,
        cursorColor: collab.cursorColor,
        ready: collab.ready,
        degraded: collab.degraded,
        synced: collab.synced,
        editable,
        onText: handleStatsText,
        onChange: handleChange,
      }),
    [
      documentId,
      collab.providerFactory,
      initialStateJson,
      userName,
      collab.cursorColor,
      collab.ready,
      collab.degraded,
      collab.synced,
      editable,
      handleStatsText,
      handleChange,
    ],
  );
  const documentPlugins = useMemo(
    () => [
      createEditorPlugin("insert-menu", () => <InsertMenuPlugin />),
      createEditorPlugin("block-spark", () => <BlockSparkPlugin />),
      createEditorPlugin("insert-visual", () => <InsertVisualPlugin />),
      createEditorPlugin("source-block-jump", () => <SourceBlockJumpPlugin />),
      createEditorPlugin("floating-text-toolbar", () => (
        <FloatingTextToolbar />
      )),
      createEditorPlugin("inline-comments", () => (
        <InlineCommentsLayer
          documentId={documentId}
          initialComments={initialComments}
        />
      )),
    ],
    [documentId, initialComments],
  );
  const renderVisualNode = useCallback(
    (props: VisualNodeRendererProps) => <VisualCard {...props} />,
    [],
  );

  return (
    <main className="flex flex-1 flex-col bg-ds-surface-sunken">
      <LexicalCollaboration>
        <LexicalComposer initialConfig={initialConfig}>
          <VisualSvgRegistryProvider>
            <VisualNodeRendererProvider renderVisualNode={renderVisualNode}>
              <RightSurfaceProvider>
                {/* `z-sticky` keeps this in-page toolbar above the article column
                below it (which is z-base), while staying below the global site
                header (`z-header`) so the header's user/language menus can open
                over this bar. The toolbar's own Share/Export menus are children
                of this stacking context and open downward over the article. */}
                <div
                  ref={editorHeaderRef}
                  data-toolbar-labels={toolbarLabels}
                  className={cx(
                    "relative z-sticky flex gap-2 border-b border-ds-border-subtle bg-ds-surface-chrome px-3 py-2 backdrop-blur sm:px-6",
                    headerStacked
                      ? "flex-col"
                      : "flex-row items-center justify-between",
                  )}
                >
                  <div
                    className={cx(
                      "flex shrink-0 items-center gap-3",
                      headerStacked
                        ? "w-full justify-between"
                        : "w-auto justify-start",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href="/app"
                        className="w-fit shrink-0 text-xs font-medium text-ds-text-muted transition hover:text-ds-text-primary"
                      >
                        ← Back
                      </Link>
                      {workspaceName && (
                        <>
                          <span className="text-xs text-ds-border-strong">
                            ·
                          </span>
                          <span className="max-w-36 truncate text-xs text-ds-text-muted">
                            {workspaceName}
                          </span>
                        </>
                      )}
                      {!canEdit && (
                        <>
                          <span className="text-xs text-ds-border-strong">
                            ·
                          </span>
                          <span className="rounded-full bg-ds-surface-sunken px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                            Read-only
                          </span>
                        </>
                      )}
                    </div>
                    <div className={cx("shrink-0", !headerStacked && "hidden")}>
                      <Presence peers={collab.peers} status={collab.status} />
                    </div>
                  </div>

                  <div
                    className={cx(
                      "flex min-w-0 flex-1 items-center gap-1 overscroll-x-contain whitespace-nowrap py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                      headerFull
                        ? "justify-end gap-2 overflow-visible"
                        : headerStacked
                          ? "justify-end overflow-x-auto"
                          : "justify-end overflow-x-auto",
                    )}
                  >
                    <div className={cx("shrink-0", headerStacked && "hidden")}>
                      <Presence peers={collab.peers} status={collab.status} />
                    </div>
                    {canEdit && (
                      <EditorToolbarGroup label="Edit document">
                        <ImportPlugin />
                        <UndoRedoControls editable={editable} />
                      </EditorToolbarGroup>
                    )}

                    {canEdit && <EditorToolbarDivider />}

                    <EditorToolbarGroup label="Document style and page guides">
                      {canEdit && <DocumentStyleButton disabled={!editable} />}
                      <PageGuidesButton
                        showPageBreaks={showPageBreaks}
                        onToggle={() => setShowPageBreaks((v) => !v)}
                      />
                    </EditorToolbarGroup>

                    {canEdit && (
                      <>
                        <EditorToolbarDivider />
                        <EditorToolbarGroup label="Table rows and columns">
                          <TableControls editable={editable} />
                        </EditorToolbarGroup>
                      </>
                    )}

                    <EditorToolbarDivider />

                    <EditorToolbarGroup label="Create and present">
                      {canEdit && (
                        <Link
                          href={`/app/documents/${documentId}/slides`}
                          aria-label="Open slide editor"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-3 text-sm font-medium text-ds-text-primary shadow-ds-raised transition-colors hover:bg-ds-state-hover active:bg-ds-state-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-ds-focus-offset"
                        >
                          <LayoutPanelLeft size={15} aria-hidden="true" />
                          <span>Slides</span>
                        </Link>
                      )}
                      <RoutedPresentButton
                        documentId={documentId}
                        documentTitle={title.value}
                      />
                      <RoutedDocumentExportButton
                        documentTitle={title.value}
                        documentId={documentId}
                        initialDeckJson={initialDeckJson}
                      />
                    </EditorToolbarGroup>

                    <EditorToolbarDivider />

                    <EditorToolbarGroup label="Collaborate and review">
                      {canManage && (
                        <ShareButton
                          id={documentId}
                          initialIsShared={initialIsShared}
                          initialShareId={initialShareId}
                          initialSlug={initialSlug}
                          initialExpiresAt={initialShareExpiresAt}
                          initialEmbedEnabled={initialShareEmbedEnabled}
                          initialPresentEnabled={initialSharePresentEnabled}
                          initialMetadataMode={initialShareMetadataMode}
                          initialDiscoverable={initialShareDiscoverable}
                          documentTitle={title.value}
                        />
                      )}
                      <VersionHistoryPanel
                        documentId={documentId}
                        canEdit={canEdit}
                      />
                    </EditorToolbarGroup>
                  </div>
                </div>

                <EditorContextProvider>
                  <VisualPanelProvider>
                    {/* Reading layout with context-aware floating toolboxes on
                      fine pointers and a bottom-sheet fallback on coarse pointers. */}
                    <div className="flex flex-1 overflow-hidden">
                      {/* Article column */}
                      <div className="flex flex-1 min-w-0 justify-center px-4 py-6 sm:px-6 sm:py-8">
                        <div className="w-full max-w-5xl">
                          <div
                            ref={contentAreaRef}
                            className="relative rounded-2xl border border-ds-border-subtle bg-ds-surface-raised p-4 sm:p-6"
                          >
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-ds-border-subtle pb-3">
                              <TagControl
                                documentId={documentId}
                                initialTags={initialTags}
                                allTags={allTags}
                                editable={canEdit}
                              />
                              <div className="flex flex-wrap items-center gap-3 text-xs text-ds-text-muted">
                                <span aria-label="Document statistics">
                                  {minutes} min read · {words}{" "}
                                  {words === 1 ? "word" : "words"}
                                </span>
                                <span role="status" aria-live="polite">
                                  {STATUS_LABEL[saveStatus]}
                                </span>
                              </div>
                            </div>
                            {showPageBreaks && (
                              <PageBreakIndicator
                                contentRef={contentAreaRef}
                                pageSize="a4"
                              />
                            )}
                            <EditorPluginHost
                              plugins={[...corePlugins, ...documentPlugins]}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Context toolbox host — visual/text popovers on fine pointers, sheet on coarse pointers */}
                      <MobileEditingSheetHost editable={editable} />
                    </div>
                  </VisualPanelProvider>
                </EditorContextProvider>
              </RightSurfaceProvider>
            </VisualNodeRendererProvider>
          </VisualSvgRegistryProvider>
        </LexicalComposer>
      </LexicalCollaboration>
    </main>
  );
}
