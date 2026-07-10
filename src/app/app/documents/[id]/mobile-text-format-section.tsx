"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { ColorPicker, Divider, IconButton, Tooltip } from "@/components/ui";
import { useEditorContext } from "@/lib/lexical/editor-context";
import {
  formatShortcut,
  isToolActive,
  toolsFor,
  type EditorTool,
} from "@/lib/lexical/tool-registry";
import { useIsMac } from "@/lib/shortcuts/use-is-mac";

function SheetToolButton({
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
              <kbd className="font-sans text-[var(--ds-text-muted,#a1a1aa)]">
                {shortcut}
              </kbd>
            </span>
          ) : (
            tool.label
          )
        }
      >
        <IconButton
          aria-label={shortcut ? `${tool.label} (${shortcut})` : tool.label}
          active={active}
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRun}
        >
          {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : tool.label}
        </IconButton>
      </Tooltip>
    </>
  );
}

function SheetColorToolButton({
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

export function TextFormatSection() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const isMac = useIsMac();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rovingIndex, setRovingIndex] = useState(0);

  const tools = useMemo(() => toolsFor("text-format", ctx), [ctx]);

  const getItems = useCallback(
    () =>
      Array.from(
        containerRef.current?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ),
    [],
  );

  useEffect(() => {
    const items = getItems();
    if (items.length === 0) return;
    const active = Math.min(rovingIndex, items.length - 1);
    items.forEach((el, index) => {
      el.tabIndex = index === active ? 0 : -1;
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

  const onFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const items = getItems();
      const index = items.findIndex((el) => el === target);
      if (index >= 0) setRovingIndex(index);
    },
    [getItems],
  );

  return (
    <div className="p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
        Text format
      </p>
      <div
        ref={containerRef}
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap items-center gap-0.5"
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        {tools.map((tool, index) => {
          const previous = tools[index - 1];
          const showDivider =
            previous !== undefined && previous.section !== tool.section;
          if (tool.control === "color") {
            return (
              <SheetColorToolButton
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
            <SheetToolButton
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
    </div>
  );
}
