"use client";

import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $isScrollableTablesActive,
  registerTableCellUnmergeTransform,
  registerTablePlugin,
  registerTableSelectionObserver,
  setScrollableTablesActive,
  TableCellNode,
  TableNode,
} from "@lexical/table";
import {
  $fullReconcile,
  $getRoot,
  $nodesOfType,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { useEffect, type ComponentProps } from "react";

import {
  $ensureBlockIdsInDocument,
  registerBlockIdTransforms,
} from "./block-id-runtime";
import { createEditorPlugin, type CoreEditorPlugin } from "./editor-api";
import { BLOCK_ID_REPAIR_TAG } from "@/lib/content";
import { installTableObserverReadGuard } from "./table-observer-guard";
import {
  useCollaborationFallbackSeed,
  useEditableGate,
} from "./use-collaboration-gate";

type CollaborationProps = ComponentProps<typeof CollaborationPlugin>;

function EditableGatePlugin({ editable }: { editable: boolean }) {
  useEditableGate(editable);
  return null;
}

function LocalFallbackSeedPlugin({
  initialStateJson,
  degraded,
  synced,
}: {
  initialStateJson: string | null;
  degraded: boolean;
  synced: boolean;
}) {
  useCollaborationFallbackSeed({ initialStateJson, degraded, synced });
  return null;
}

function DocumentStatsPlugin({ onText }: { onText: (text: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const read = (state: EditorState) => {
      state.read(() => {
        onText($getRoot().getTextContent());
      });
    };
    read(editor.getEditorState());
    return editor.registerUpdateListener(({ editorState }) => {
      read(editorState);
    });
  }, [editor, onText]);
  return null;
}

function DurableBlockIdPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterTransforms = registerBlockIdTransforms(editor);
    editor.update(
      () => {
        $ensureBlockIdsInDocument();
      },
      { discrete: true, tag: BLOCK_ID_REPAIR_TAG },
    );
    return unregisterTransforms;
  }, [editor]);

  return null;
}

function hasMountedTableDOM(editor: LexicalEditor): boolean {
  let tableKeys: string[] = [];
  editor.getEditorState().read(() => {
    tableKeys = $nodesOfType(TableNode).map((node) => node.getKey());
  });

  return tableKeys.every((tableKey) => {
    const element = editor.getElementByKey(tableKey);
    return (
      element?.tagName === "TABLE" || element?.querySelector("table") !== null
    );
  });
}

function isMissingTableDOMError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "TableObserver: Expected to find TableElement in DOM",
    )
  );
}

function DocumentTablePlugin({
  hasCellMerge = true,
  hasCellBackgroundColor = true,
  hasTabHandler = true,
  hasHorizontalScroll = false,
}: {
  hasCellMerge?: boolean;
  hasCellBackgroundColor?: boolean;
  hasTabHandler?: boolean;
  hasHorizontalScroll?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  // Installed permanently (never disposed): a leaked @lexical/table
  // MutationObserver can fire against this editor after the plugin unmounts, so
  // the read-guard must outlive the plugin. Idempotent per editor instance.
  useEffect(() => {
    installTableObserverReadGuard(editor);
  }, [editor]);

  useEffect(() => {
    const hadHorizontalScroll = $isScrollableTablesActive(editor);
    if (hadHorizontalScroll !== hasHorizontalScroll) {
      setScrollableTablesActive(editor, hasHorizontalScroll);
      editor.update($fullReconcile);
    }
  }, [editor, hasHorizontalScroll]);

  useEffect(() => registerTablePlugin(editor), [editor]);

  useEffect(() => {
    let disposed = false;
    let frame: number | null = null;
    let unregister: (() => void) | undefined;

    const scheduleRegister = () => {
      if (disposed || frame !== null || unregister) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        registerWhenTablesAreMounted();
      });
    };

    const registerWhenTablesAreMounted = () => {
      if (disposed || unregister) {
        return;
      }
      if (!hasMountedTableDOM(editor)) {
        scheduleRegister();
        return;
      }
      try {
        unregister = registerTableSelectionObserver(editor, hasTabHandler);
      } catch (error) {
        if (!isMissingTableDOMError(error)) {
          throw error;
        }
        scheduleRegister();
      }
    };

    registerWhenTablesAreMounted();

    return () => {
      disposed = true;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      unregister?.();
    };
  }, [editor, hasTabHandler]);

  useEffect(() => {
    if (!hasCellMerge) {
      return registerTableCellUnmergeTransform(editor);
    }
  }, [editor, hasCellMerge]);

  useEffect(() => {
    if (hasCellBackgroundColor) {
      return;
    }
    return editor.registerNodeTransform(TableCellNode, (node) => {
      if (node.getBackgroundColor() !== null) {
        node.setBackgroundColor(null);
      }
    });
  }, [editor, hasCellBackgroundColor]);

  return null;
}

function CoreRichTextPlugin({ ready }: { ready: boolean }) {
  return (
    <div className="relative">
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Document body"
            className="ds-prose min-h-[16rem] outline-none"
          />
        }
        placeholder={
          <div className="pointer-events-none absolute left-0 top-0 text-base text-ds-text-muted">
            {ready ? "Start writing…" : "Connecting…"}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
    </div>
  );
}

export function createCoreEditorPlugins({
  documentId,
  providerFactory,
  initialStateJson,
  userName,
  cursorColor,
  ready,
  degraded,
  synced,
  editable,
  onText,
  onChange,
}: {
  documentId: string;
  providerFactory: CollaborationProps["providerFactory"];
  initialStateJson: string | null;
  userName: string;
  cursorColor: string;
  ready: boolean;
  degraded: boolean;
  synced: boolean;
  editable: boolean;
  onText(text: string): void;
  onChange: ComponentProps<typeof OnChangePlugin>["onChange"];
}): CoreEditorPlugin[] {
  return [
    createEditorPlugin("rich-text", () => <CoreRichTextPlugin ready={ready} />),
    createEditorPlugin("collaboration", () => (
      <CollaborationPlugin
        id={documentId}
        providerFactory={providerFactory}
        shouldBootstrap
        initialEditorState={initialStateJson ?? null}
        username={userName}
        cursorColor={cursorColor}
      />
    )),
    createEditorPlugin("durable-block-ids", () => <DurableBlockIdPlugin />),
    createEditorPlugin("editable-gate", () => (
      <EditableGatePlugin editable={editable} />
    )),
    createEditorPlugin("local-fallback-seed", () => (
      <LocalFallbackSeedPlugin
        initialStateJson={initialStateJson}
        degraded={degraded}
        synced={synced}
      />
    )),
    createEditorPlugin("document-stats", () => (
      <DocumentStatsPlugin onText={onText} />
    )),
    createEditorPlugin("list", () => <ListPlugin />),
    createEditorPlugin("link", () => <LinkPlugin />),
    createEditorPlugin("table", () => (
      <DocumentTablePlugin
        hasCellMerge={false}
        hasCellBackgroundColor={false}
        hasHorizontalScroll={false}
        hasTabHandler
      />
    )),
    createEditorPlugin("horizontal-rule", () => <HorizontalRulePlugin />),
    createEditorPlugin("autosave", () => (
      <OnChangePlugin
        onChange={onChange}
        ignoreSelectionChange
        ignoreHistoryMergeTagChange={false}
      />
    )),
  ];
}
