"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  HISTORIC_TAG,
  REDO_COMMAND,
  UNDO_COMMAND,
  type EditorState,
} from "lexical";
import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { IconButton, Tooltip } from "@/components/ui";
import { BLOCK_ID_REPAIR_TAG } from "@/lib/content";
import { useIsMac } from "@/lib/shortcuts/use-is-mac";

type JsonObject = { [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripVolatileEditorFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatileEditorFields);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const result: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "bid") {
      continue;
    }
    result[key] = stripVolatileEditorFields(value[key]);
  }
  return result;
}

export function canonicalUndoBaselineJson(value: unknown): string {
  return JSON.stringify(stripVolatileEditorFields(value));
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rootChildren(value: unknown): unknown[] {
  if (!isJsonObject(value)) {
    return [];
  }
  const root = value.root;
  if (!isJsonObject(root) || !Array.isArray(root.children)) {
    return [];
  }
  return root.children;
}

function isEmptyParagraphNode(value: unknown): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    value.type === "paragraph" &&
    Array.isArray(value.children) &&
    value.children.length === 0
  );
}

export function matchesProtectedUndoBaseline(
  editorJson: unknown,
  initialStateJson: string | null,
): boolean {
  if (initialStateJson === null) {
    const children = rootChildren(editorJson);
    return (
      children.length === 0 ||
      (children.length === 1 && isEmptyParagraphNode(children[0]))
    );
  }
  const initialJson = parseJson(initialStateJson);
  if (initialJson === null) {
    return false;
  }
  return (
    canonicalUndoBaselineJson(editorJson) ===
    canonicalUndoBaselineJson(initialJson)
  );
}

function editorStateMatchesProtectedBaseline(
  editorState: EditorState,
  initialStateJson: string | null,
): boolean {
  return matchesProtectedUndoBaseline(editorState.toJSON(), initialStateJson);
}

/**
 * Discoverable Undo / Redo buttons that surface the Yjs UndoManager already
 * wired by {@link CollaborationPlugin} via `useYjsHistory`.
 *
 * • Registers `CAN_UNDO_COMMAND` / `CAN_REDO_COMMAND` listeners (low priority,
 *   non-consuming) so the button disabled state mirrors the live undo/redo stack.
 * • Dispatches `UNDO_COMMAND` / `REDO_COMMAND` on click — the registered handler
 *   in `useYjsHistory` calls `undoManager.undo()` / `undoManager.redo()`, which
 *   reverts both text edits and visual edits (the `__visual` property of
 *   `VisualNode` is synced to Yjs via `syncPropertiesFromLexical`, so it lives
 *   inside the tracked transaction origin and the UndoManager captures it).
 * • Must be rendered inside a `LexicalComposer`.
 * • In degraded local-only mode the Yjs binding is still active and local edits
 *   are still tracked, so undo works as expected; buttons are simply disabled
 *   until there is history to undo/redo (i.e. until `CAN_UNDO_COMMAND` fires).
 */
export function UndoRedoControls({
  editable,
  initialStateJson,
}: {
  editable: boolean;
  initialStateJson: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const [rawCanUndo, setRawCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [currentAtProtectedBaseline, setCurrentAtProtectedBaseline] =
    useState(true);
  const [blockProtectedBaselineUndo, setBlockProtectedBaselineUndo] =
    useState(true);
  const isMac = useIsMac();
  const pendingUndoRef = useRef(false);
  const pendingRedoRef = useRef(false);
  const currentAtProtectedBaselineRef = useRef(currentAtProtectedBaseline);
  const blockProtectedBaselineUndoRef = useRef(blockProtectedBaselineUndo);

  useEffect(() => {
    currentAtProtectedBaselineRef.current = currentAtProtectedBaseline;
  }, [currentAtProtectedBaseline]);

  useEffect(() => {
    blockProtectedBaselineUndoRef.current = blockProtectedBaselineUndo;
  }, [blockProtectedBaselineUndo]);

  const shouldBlockUndo = useCallback(
    () =>
      currentAtProtectedBaselineRef.current &&
      blockProtectedBaselineUndoRef.current,
    [],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload: boolean) => {
          setRawCanUndo(payload);
          return false; // don't consume — let other handlers see it
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload: boolean) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        UNDO_COMMAND,
        () => {
          if (shouldBlockUndo()) {
            return true;
          }
          pendingUndoRef.current = true;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        REDO_COMMAND,
        () => {
          pendingRedoRef.current = true;
          setBlockProtectedBaselineUndo(false);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [editor, shouldBlockUndo]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({ editorState, prevEditorState, tags }) => {
        const nextAtBaseline = editorStateMatchesProtectedBaseline(
          editorState,
          initialStateJson,
        );
        setCurrentAtProtectedBaseline(nextAtBaseline);

        if (pendingUndoRef.current) {
          pendingUndoRef.current = false;
          if (nextAtBaseline) {
            setBlockProtectedBaselineUndo(true);
          }
          return;
        }
        if (pendingRedoRef.current) {
          pendingRedoRef.current = false;
          setBlockProtectedBaselineUndo(false);
          return;
        }

        if (!editable) {
          return;
        }
        if (
          tags.has(COLLABORATION_TAG) ||
          tags.has(HISTORIC_TAG) ||
          tags.has(BLOCK_ID_REPAIR_TAG)
        ) {
          return;
        }
        if (
          canonicalUndoBaselineJson(prevEditorState.toJSON()) !==
          canonicalUndoBaselineJson(editorState.toJSON())
        ) {
          setBlockProtectedBaselineUndo(false);
        }
      },
    );
  }, [editable, editor, initialStateJson]);

  const canUndo =
    rawCanUndo && !(currentAtProtectedBaseline && blockProtectedBaselineUndo);

  const undoShortcut = isMac ? "⌘Z" : "Ctrl+Z";
  const redoShortcut = isMac ? "⌘⇧Z" : "Ctrl+Shift+Z";

  return (
    <div role="group" aria-label="Undo and redo" className="flex items-center">
      <Tooltip label={`Undo (${undoShortcut})`} side="bottom">
        <IconButton
          aria-label={`Undo (${undoShortcut})`}
          size="sm"
          variant="plain"
          disabled={!editable || !canUndo}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        >
          <Undo2 aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </Tooltip>
      <Tooltip label={`Redo (${redoShortcut})`} side="bottom">
        <IconButton
          aria-label={`Redo (${redoShortcut})`}
          size="sm"
          variant="plain"
          disabled={!editable || !canRedo}
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        >
          <Redo2 aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </Tooltip>
    </div>
  );
}
