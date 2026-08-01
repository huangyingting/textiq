"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH, KEY_TAB_COMMAND } from "lexical";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  ColorPicker,
  Divider,
  FloatingSurface,
  IconButton,
  Kbd,
  Tooltip,
} from "@/components/ui";
import { actionAriaKeyShortcuts } from "@/lib/actions/action-descriptor";
import { computeAnchoredPosition } from "@/lib/anchored-position";
import { useEditorContext } from "@/lib/lexical/editor-context";
import {
  formatShortcut,
  isToolActive,
  toolsFor,
  type EditorTool,
} from "@/lib/lexical/tool-registry";

import { useIsMac } from "@/lib/shortcuts/use-is-mac";

import { useEditingSurface } from "./use-editing-surface";

// Gap (px) between the text selection and the floating toolbar.
const TOOLBAR_GAP = 10;
// Minimum inset from the viewport edges.
const EDGE_INSET = 8;

/**
 * The registry-driven floating selection toolbar. It reads the shared
 * {@link useEditorContext} snapshot (it runs no `selectionchange` listener or
 * rect math of its own) and renders the visible `text-format` tools from the
 * {@link toolsFor} registry as icon buttons. It appears above a non-collapsed
 * text selection and flips below it near the top edge.
 *
 * All actions go through `tool.run(editor, ctx)`, which wraps Lexical commands /
 * `editor.update()` only — never Yjs, never persisted NodeKeys.
 */
export function FloatingTextToolbar() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const isMac = useIsMac();
  const surface = useEditingSurface();
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: -1000,
    left: -1000,
  });

  const tools = useMemo(() => toolsFor("text-format", ctx), [ctx]);
  const selectionRect = ctx.rects.selection;
  // Visibility is derived from the single unified decision source
  // (resolveEditingSurface via useEditingSurface): desktop text selections use
  // the right toolbox, while smaller fine-pointer viewports keep this anchored
  // float. The positioning gates (editable + a measured selection rect) remain
  // as additional render guards.
  const visible =
    surface.mode === "float" &&
    surface.group === "text-format" &&
    ctx.editable &&
    selectionRect !== null;

  // Roving tabindex (WAI-ARIA toolbar pattern): only one button is tabbable at a
  // time; ArrowLeft/Right (and Up/Down/Home/End) move focus between buttons.
  const [rovingIndex, setRovingIndex] = useState(0);
  const getItems = useCallback(
    () =>
      Array.from(
        measureRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ),
    [],
  );

  // The toolbar is portalled after the editor subtree. Without an explicit
  // handoff, pressing Tab from a text selection reaches later controls inside
  // the document (for example, an embedded visual) before it can reach this
  // contextual toolbar. Consume plain Tab only while the toolbar is visible
  // and move focus to its current roving item; Shift+Tab and modified Tab keep
  // their native behavior.
  useEffect(() => {
    if (!visible) return;

    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        const items = getItems();
        if (items.length === 0) return false;

        event.preventDefault();
        const active = Math.min(rovingIndex, items.length - 1);
        setRovingIndex(active);
        items[active]?.focus();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, getItems, rovingIndex, visible]);

  // Reset the roving cursor when the toolbar closes so it reopens at the first
  // tool. Uses the render-phase "adjust state" pattern (no setState in effect).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (!visible) {
      setRovingIndex(0);
    }
  }

  // Keep exactly one button tabbable (tabIndex 0); the rest are -1. Re-applied
  // when the visible tool set or roving cursor changes.
  useLayoutEffect(() => {
    const items = getItems();
    if (items.length === 0) {
      return;
    }
    const active = Math.min(rovingIndex, items.length - 1);
    items.forEach((el, index) => {
      el.tabIndex = index === active ? 0 : -1;
    });
  }, [getItems, visible, tools, rovingIndex, coords]);

  const onToolbarKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        // Dismiss focus from the toolbar and hand it back to the editor.
        event.preventDefault();
        editor.focus();
        return;
      }
      const items = getItems();
      if (items.length === 0) {
        return;
      }
      const current = items.findIndex((el) => el === document.activeElement);
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

  const onToolbarFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const items = getItems();
      const index = items.findIndex((el) => el === target);
      if (index >= 0) {
        setRovingIndex(index);
      }
    },
    [getItems],
  );

  // Position over the selection rect via the shared anchored-positioning helper
  // (auto-flip below near the top edge, cross-axis clamp to the viewport, and
  // anchor-collision avoidance). Re-runs whenever the rect moves (the
  // EditorContext refreshes rects on scroll/resize) or the visible tool set
  // changes. We measure the inner content wrapper and add the surface's 1px
  // border on each side.
  useLayoutEffect(() => {
    if (!visible || selectionRect === null) {
      return;
    }
    const el = measureRef.current;
    if (el === null) {
      return;
    }
    const width = el.offsetWidth + 2;
    const height = el.offsetHeight + 2;
    const { top, left } = computeAnchoredPosition({
      anchor: selectionRect,
      float: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: "top",
      gap: TOOLBAR_GAP,
      padding: EDGE_INSET,
    });
    setCoords({ top, left });
  }, [visible, selectionRect, tools.length]);

  return (
    <FloatingSurface
      open={visible}
      position={coords}
      role="toolbar"
      aria-label="Text formatting"
      elevation="overlay"
      radius="lg"
      keepSelection
      closeOnEscape={false}
      closeOnClickAway={false}
    >
      <div
        ref={measureRef}
        className="flex max-w-[20rem] flex-wrap items-center justify-center gap-0.5 p-1"
        onKeyDown={onToolbarKeyDown}
        onFocus={onToolbarFocus}
      >
        {tools.map((tool, index) => {
          const previous = tools[index - 1];
          const showDivider =
            previous !== undefined && previous.section !== tool.section;
          if (tool.control === "color") {
            return (
              <ColorToolButton
                key={tool.id}
                tool={tool}
                active={isToolActive(tool, ctx)}
                value={tool.value ? tool.value(ctx) : ""}
                showDivider={showDivider}
                onPick={(next) => tool.apply?.(editor, next)}
                onReset={() => tool.apply?.(editor, null)}
              />
            );
          }
          return (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={isToolActive(tool, ctx)}
              shortcut={formatShortcut(tool.shortcut, isMac)}
              showDivider={showDivider}
              onRun={() => tool.run?.(editor, ctx)}
            />
          );
        })}
      </div>
    </FloatingSurface>
  );
}

function ToolButton({
  tool,
  active,
  shortcut,
  showDivider,
  onRun,
}: {
  tool: EditorTool;
  active: boolean;
  shortcut?: string;
  showDivider: boolean;
  onRun: () => void;
}) {
  const Icon = tool.icon;
  return (
    <>
      {showDivider ? <Divider /> : null}
      <Tooltip
        label={
          shortcut ? (
            <span className="inline-flex items-center gap-1.5">
              {tool.label}
              <Kbd>{shortcut}</Kbd>
            </span>
          ) : (
            tool.label
          )
        }
      >
        <IconButton
          aria-label={shortcut ? `${tool.label} (${shortcut})` : tool.label}
          aria-keyshortcuts={actionAriaKeyShortcuts(tool.action)}
          title={tool.action.disabledReason ?? tool.action.description}
          active={active}
          size="sm"
          // preventDefault keeps the editor text selection intact on click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRun}
        >
          {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : tool.label}
        </IconButton>
      </Tooltip>
    </>
  );
}

/**
 * A `"color"` control: a swatch-triggered {@link ColorPicker} popover for text
 * color / highlight. The trigger shows the format icon over a thin bar of the
 * current selection color; the popover offers presets, a custom value, and a
 * "Default" reset that clears the inline style. Picking a color routes through
 * `tool.apply` (`$patchStyleText` inside `editor.update()`); reset clears it.
 */
function ColorToolButton({
  tool,
  active,
  value,
  showDivider,
  onPick,
  onReset,
}: {
  tool: EditorTool;
  active: boolean;
  value: string;
  showDivider: boolean;
  onPick: (next: string) => void;
  onReset: () => void;
}) {
  const Icon = tool.icon;
  return (
    <>
      {showDivider ? <Divider /> : null}
      <Tooltip label={tool.label}>
        <span
          className="inline-flex"
          // preventDefault keeps the editor text selection intact on click.
          onMouseDown={(event) => event.preventDefault()}
        >
          <ColorPicker
            color={value}
            active={active}
            aria-label={tool.label}
            size="sm"
            icon={
              Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : undefined
            }
            preserveSelection
            onChange={onPick}
            onReset={onReset}
            resetLabel="Default (none)"
          />
        </span>
      </Tooltip>
    </>
  );
}
