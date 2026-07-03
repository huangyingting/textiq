"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  Columns3,
  Minus,
  MoreHorizontal,
  PanelTop,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  Divider,
  FloatingSurface,
  IconButton,
  Popover,
  ToolbarMenuItem,
  Tooltip,
  cx,
} from "@/components/ui";
import { computeAnchoredPosition } from "@/lib/anchored-position";
import { refreshDocumentTableCaptionDOM } from "@/lib/lexical/table-caption-runtime";
import {
  $getDocumentTableStateForKey,
  $getSelectedDocumentTableState,
  runDocumentTableControl,
  type DocumentTableControlAction,
  type DocumentTableControlState,
} from "@/lib/lexical/table-controls";

import { useActiveTableCaptionKey } from "./use-active-table-caption";
import { useEditingSurface } from "./use-editing-surface";

const TOOLBAR_GAP = 8;
const EDGE_INSET = 8;

function readTableControlState(
  editor: LexicalEditor,
  fallbackTableKey: string | null,
): DocumentTableControlState | null {
  return editor.getEditorState().read(() => {
    const selected = $getSelectedDocumentTableState();
    if (selected) return selected;
    return fallbackTableKey
      ? $getDocumentTableStateForKey(fallbackTableKey)
      : null;
  });
}

function useTableControlState(): DocumentTableControlState | null {
  const [editor] = useLexicalComposerContext();
  const activeCaptionTableKey = useActiveTableCaptionKey();
  const [state, setState] = useState(() =>
    readTableControlState(editor, activeCaptionTableKey),
  );

  const recompute = useCallback(() => {
    setState(readTableControlState(editor, activeCaptionTableKey));
  }, [activeCaptionTableKey, editor]);

  useEffect(() => {
    queueMicrotask(recompute);
  }, [recompute]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selected = $getSelectedDocumentTableState();
          setState(
            selected ??
              (activeCaptionTableKey
                ? $getDocumentTableStateForKey(activeCaptionTableKey)
                : null),
          );
        });
      }),
      editor.registerEditableListener(recompute),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          recompute();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [activeCaptionTableKey, editor, recompute]);

  return state;
}

function tableElementFromEditor(
  editor: LexicalEditor,
  tableKey: string | null | undefined,
): HTMLElement | null {
  if (!tableKey) return null;
  return editor.getElementByKey(tableKey);
}

function useActiveTableDomSync(
  editor: LexicalEditor,
  tableKey: string | null | undefined,
): void {
  useEffect(() => {
    const element = tableElementFromEditor(editor, tableKey);
    if (!element) return;
    const table =
      element instanceof HTMLTableElement
        ? element
        : element.querySelector("table");
    if (table instanceof HTMLTableElement) {
      table.dataset.tableEditingActive = "true";
    }
    refreshDocumentTableCaptionDOM(element);
    return () => {
      if (table instanceof HTMLTableElement) {
        delete table.dataset.tableEditingActive;
      }
      refreshDocumentTableCaptionDOM(element);
    };
  }, [editor, tableKey]);
}

function useToolbarRovingFocus(
  editor: LexicalEditor,
  ref: RefObject<HTMLDivElement | null>,
) {
  const [rovingIndex, setRovingIndex] = useState(0);
  const getItems = useCallback(
    () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      ),
    [ref],
  );

  useLayoutEffect(() => {
    const items = getItems();
    if (items.length === 0) return;
    const active = Math.min(rovingIndex, items.length - 1);
    items.forEach((item, index) => {
      item.tabIndex = index === active ? 0 : -1;
    });
  });

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        editor.focus();
        return;
      }
      const items = getItems();
      if (items.length === 0) return;
      const current = items.findIndex(
        (item) => item === document.activeElement,
      );
      let next: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = current < 0 ? 0 : (current + 1) % items.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = current < 0 ? 0 : (current - 1 + items.length) % items.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = items.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      setRovingIndex(next);
      items[next]?.focus();
    },
    [editor, getItems],
  );

  const onFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const index = getItems().findIndex((item) => item === target);
      if (index >= 0) setRovingIndex(index);
    },
    [getItems],
  );

  return { onKeyDown, onFocus };
}

function TableActionIcon({
  base,
  badge,
}: {
  base: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      {base}
      {badge ? (
        <span className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-ds-pill bg-ds-surface-raised text-ds-text-primary shadow-ds-flat">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function TableIconButton({
  label,
  active,
  disabled,
  onRun,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <IconButton
        aria-label={label}
        active={active}
        disabled={disabled}
        size="sm"
        variant="plain"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRun}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

function TableMoreMenu({ onDeleteTable }: { onDeleteTable: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      className="w-48 p-1"
      trigger={
        <span className="inline-flex">
          <TableIconButton
            label="More table actions"
            onRun={() => setOpen((value) => !value)}
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </TableIconButton>
        </span>
      }
    >
      <ToolbarMenuItem
        className="text-ds-danger hover:text-ds-danger"
        icon={<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
        onClick={() => {
          setOpen(false);
          onDeleteTable();
        }}
      >
        Delete table
      </ToolbarMenuItem>
    </Popover>
  );
}

function confirmDeleteTable(): boolean {
  return window.confirm("Delete table?");
}

function TableEditingControls({
  state,
  className,
}: {
  state: DocumentTableControlState;
  className?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const roving = useToolbarRovingFocus(editor, toolbarRef);
  const run = useCallback(
    (action: DocumentTableControlAction) => {
      runDocumentTableControl(editor, action, state.tableKey);
    },
    [editor, state.tableKey],
  );
  const deleteTable = useCallback(() => {
    if (confirmDeleteTable()) {
      run("delete-table");
    }
  }, [run]);
  const sizeLabel = `${state.rows} rows by ${state.columns} columns`;

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Table editing"
      className={cx("flex flex-wrap items-center gap-0.5", className)}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      <Tooltip label={sizeLabel}>
        <span
          aria-label={sizeLabel}
          className="flex h-7 min-w-12 select-none items-center justify-center rounded-ds-sm px-2 text-xs font-semibold text-ds-text-muted"
        >
          {state.rows} × {state.columns}
        </span>
      </Tooltip>
      <Divider />
      <TableIconButton
        label={
          state.headerRow ? "Remove header row" : "Mark first row as header"
        }
        active={state.headerRow}
        onRun={() => run("toggle-header-row")}
      >
        <PanelTop aria-hidden="true" className="h-4 w-4" />
      </TableIconButton>
      <Divider />
      <TableIconButton
        label="Add row below"
        onRun={() => run("insert-row-after")}
      >
        <TableActionIcon
          base={<Rows3 aria-hidden="true" className="h-4 w-4" />}
          badge={<Plus aria-hidden="true" className="h-2 w-2" />}
        />
      </TableIconButton>
      <TableIconButton
        label="Delete row"
        disabled={!state.canDeleteRow}
        onRun={() => run("delete-row")}
      >
        <TableActionIcon
          base={<Rows3 aria-hidden="true" className="h-4 w-4" />}
          badge={<Minus aria-hidden="true" className="h-2 w-2" />}
        />
      </TableIconButton>
      <Divider />
      <TableIconButton
        label="Add column right"
        onRun={() => run("insert-column-after")}
      >
        <TableActionIcon
          base={<Columns3 aria-hidden="true" className="h-4 w-4" />}
          badge={<Plus aria-hidden="true" className="h-2 w-2" />}
        />
      </TableIconButton>
      <TableIconButton
        label="Delete column"
        disabled={!state.canDeleteColumn}
        onRun={() => run("delete-column")}
      >
        <TableActionIcon
          base={<Columns3 aria-hidden="true" className="h-4 w-4" />}
          badge={<Minus aria-hidden="true" className="h-2 w-2" />}
        />
      </TableIconButton>
      <Divider />
      <TableMoreMenu onDeleteTable={deleteTable} />
    </div>
  );
}

export function TableEditingSection() {
  const state = useTableControlState();
  if (!state) return null;
  return (
    <div className="p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ds-text-muted">
        Table
      </p>
      <TableEditingControls state={state} />
    </div>
  );
}

export function FloatingTableToolbar({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const surface = useEditingSurface();
  const state = useTableControlState();
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState({ top: -1000, left: -1000 });
  const tableKey = state?.tableKey ?? null;
  useActiveTableDomSync(editor, tableKey);

  const visible =
    editable &&
    state !== null &&
    surface.mode === "float" &&
    surface.group === "table-edit";

  const reposition = useCallback(() => {
    if (!visible || tableKey === null) {
      return;
    }
    const anchor = tableElementFromEditor(editor, tableKey);
    const el = measureRef.current;
    if (anchor === null || el === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = el.offsetWidth + 2;
    const height = el.offsetHeight + 2;
    const { top, left } = computeAnchoredPosition({
      anchor: rect,
      float: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: "top",
      gap: TOOLBAR_GAP,
      padding: EDGE_INSET,
    });
    setCoords((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [editor, tableKey, visible]);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [reposition, visible, state?.rows, state?.columns, state?.headerRow]);

  return (
    <FloatingSurface
      open={visible}
      position={coords}
      role="toolbar"
      aria-label="Table editing"
      elevation="overlay"
      radius="lg"
      closeOnEscape={false}
      closeOnClickAway={false}
    >
      <div ref={measureRef} className="max-w-[calc(100vw-1rem)] p-1">
        {state ? <TableEditingControls state={state} /> : null}
      </div>
    </FloatingSurface>
  );
}
