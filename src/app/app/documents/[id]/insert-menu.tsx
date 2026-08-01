"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from "lexical";
import { Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

import { GUTTER_BUTTON } from "@/components/ui/tokens";
import { usePopMotion } from "@/components/motion/reveal";
import { FloatingSurface, PopoverSection } from "@/components/ui";
import { cx } from "@/components/ui/tokens";
import { useEditorContext } from "@/lib/lexical/editor-context";
import { useIsPointerFine } from "@/lib/pointer";
import { toolsFor, type EditorTool } from "@/lib/lexical/tool-registry";

import {
  DOCUMENT_GUTTER_BUTTON_SIZE,
  leftGutterButtonLeft,
} from "./document-gutter";

// Gap (px) between the anchored block and the menu / gutter button.
const MENU_GAP = 6;

type MenuMode = "plus" | "slash";

/** A section header + its (filtered) tools, for grouped rendering. */
type MenuSection = {
  id: "block-insert" | "visual-insert";
  label: string;
  tools: EditorTool[];
};

function matchesQuery(tool: EditorTool, query: string): boolean {
  if (query === "") {
    return true;
  }
  if (tool.label.toLowerCase().includes(query)) {
    return true;
  }
  return (tool.keywords ?? []).some((keyword) => keyword.includes(query));
}

/**
 * The unified `+`/`/` block & visual insert menu, rebuilt onto the shared
 * `FloatingSurface` and driven entirely by the {@link "@/lib/lexical/tool-registry"
 * ToolRegistry}. It reads the shared {@link useEditorContext} snapshot — it runs
 * no selection listener or rect math of its own — and renders two labelled
 * sections: "Text" ({@link toolsFor}`("block-insert")`) and "Visuals"
 * ({@link toolsFor}`("visual-insert")`), each item icon-first.
 *
 * Affordances:
 *  - A "+" gutter button on an empty paragraph opens the menu (keyboard-driven,
 *    menu takes focus).
 *  - Typing "/" at the start of any single block opens the same menu, filtered
 *    by the typed text; the editor keeps focus so typing keeps filtering, and
 *    arrow/Enter/Escape are handled via Lexical key commands.
 *
 * Choosing a "Text" item transforms the current block; choosing a "Visuals" item
 * dispatches `INSERT_VISUAL_COMMAND` (Tank's handler owns insertion). The menu
 * never builds nodes or writes visuals itself — it only invokes `tool.run`.
 */
export function InsertMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const popMotion = usePopMotion();
  const isPointerFine = useIsPointerFine();

  // `plus` is explicit (opened by clicking the gutter button); `slash` is
  // derived from the live snapshot (a "/query" trigger in the active block).
  const [plusOpen, setPlusOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const blockRect = ctx.rects.block;

  // Derive the slash trigger from the snapshot: a collapsed caret in a block
  // whose text is "/" optionally followed by a non-whitespace filter.
  const rawSlash = useMemo(() => {
    if (!ctx.editable || ctx.kind === "range" || ctx.kind === "visual") {
      return null;
    }
    const text = ctx.blockText ?? "";
    const match = /^\/(\S*)$/.exec(text);
    return match ? { query: match[1].toLowerCase() } : null;
  }, [ctx.editable, ctx.kind, ctx.blockText]);
  const slashTriggerKey = rawSlash
    ? JSON.stringify([ctx.blockKey ?? "", ctx.blockText ?? ""])
    : null;
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(
    null,
  );
  if (dismissedSlashKey !== null && dismissedSlashKey !== slashTriggerKey) {
    setDismissedSlashKey(null);
  }
  const slash =
    rawSlash !== null && dismissedSlashKey !== slashTriggerKey
      ? rawSlash
      : null;

  // The "+" gutter button shows on an empty paragraph (only when no menu is
  // open, and only on fine-pointer/desktop devices — it's a hover affordance).
  const showGutter =
    isPointerFine &&
    ctx.editable &&
    ctx.kind === "empty-block" &&
    blockRect !== null &&
    !plusOpen &&
    slash === null;

  const mode: MenuMode | null = plusOpen
    ? "plus"
    : slash !== null
      ? "slash"
      : null;
  const query = mode === "slash" && slash !== null ? slash.query : "";

  const sections = useMemo<MenuSection[]>(() => {
    const blockTools = toolsFor("block-insert", ctx).filter((tool) =>
      matchesQuery(tool, query),
    );
    const visualTools = toolsFor("visual-insert", ctx).filter((tool) =>
      matchesQuery(tool, query),
    );
    const result: MenuSection[] = [];
    if (blockTools.length > 0) {
      result.push({ id: "block-insert", label: "Text", tools: blockTools });
    }
    if (visualTools.length > 0) {
      result.push({
        id: "visual-insert",
        label: "Visuals",
        tools: visualTools,
      });
    }
    return result;
  }, [ctx, query]);

  // Flattened tool list (section order) for linear keyboard navigation.
  const flatTools = useMemo(
    () => sections.flatMap((section) => section.tools),
    [sections],
  );
  const safeActive =
    flatTools.length === 0 ? 0 : Math.min(activeIndex, flatTools.length - 1);

  // Reset the highlighted item whenever the open mode or filter changes, using
  // React's "adjust state during render" pattern (no setState-in-effect).
  const navKey = `${mode ?? "closed"}:${query}`;
  const [prevNavKey, setPrevNavKey] = useState(navKey);
  if (navKey !== prevNavKey) {
    setPrevNavKey(navKey);
    setActiveIndex(0);
  }

  const closeMenu = useCallback(() => {
    setPlusOpen(false);
    setActiveIndex(0);
  }, []);

  // If a "/" trigger no longer matches any tool, behave like normal text.
  const slashHasMatches = slash !== null && flatTools.length > 0;

  // Run the chosen tool. "Text" tools replace the current block (clearing any
  // "/filter" text). "Visuals" tools dispatch the insert command; in slash mode
  // we first replace the trigger block with a clean empty paragraph so the
  // "/query" text isn't left behind before the visual is inserted after it.
  const commit = useCallback(
    (tool: EditorTool) => {
      if (mode === "slash" && tool.group === "visual-insert" && ctx.blockKey) {
        const blockKey = ctx.blockKey;
        editor.update(() => {
          const node = $getNodeByKey(blockKey);
          const top = node
            ? $isElementNode(node)
              ? node
              : node.getTopLevelElement()
            : null;
          if (top !== null && $isElementNode(top)) {
            const paragraph = $createParagraphNode();
            top.replace(paragraph);
            paragraph.select();
          }
        });
      }
      tool.run?.(editor, ctx);
      closeMenu();
      editor.focus();
    },
    [editor, ctx, mode, closeMenu],
  );

  // Refs keep the Lexical key-command handlers (slash mode) free of stale
  // closures.
  const slashActiveRef = useRef(false);
  const slashTriggerKeyRef = useRef<string | null>(slashTriggerKey);
  const flatToolsRef = useRef(flatTools);
  const activeIndexRef = useRef(safeActive);
  const commitRef = useRef(commit);
  useEffect(() => {
    slashActiveRef.current = mode === "slash" && slashHasMatches;
    slashTriggerKeyRef.current = slashTriggerKey;
    flatToolsRef.current = flatTools;
    activeIndexRef.current = safeActive;
    commitRef.current = commit;
  });

  // Keyboard navigation for the "/" slash menu (the editor keeps focus).
  useEffect(() => {
    const move = (delta: number) => {
      const len = flatToolsRef.current.length;
      if (len === 0) {
        return;
      }
      // Clamp at the ends (no wrap) so it behaves like a standard dropdown.
      setActiveIndex((index) => Math.min(Math.max(index + delta, 0), len - 1));
    };

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!slashActiveRef.current) {
            return false;
          }
          event?.preventDefault();
          move(1);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!slashActiveRef.current) {
            return false;
          }
          event?.preventDefault();
          move(-1);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!slashActiveRef.current) {
            return false;
          }
          const tool = flatToolsRef.current[activeIndexRef.current];
          if (tool === undefined) {
            return false;
          }
          event?.preventDefault();
          commitRef.current(tool);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!slashActiveRef.current) {
            return false;
          }
          event?.preventDefault();
          setDismissedSlashKey(slashTriggerKeyRef.current);
          closeMenu();
          editor.focus();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, closeMenu]);

  // Focus the menu when opened via the "+" button so it can be keyboard-driven;
  // the "/" flow deliberately keeps focus in the editor.
  useEffect(() => {
    if (plusOpen) {
      menuRef.current?.focus();
    }
  }, [plusOpen]);

  // Keep the highlighted option scrolled into view as the selection moves
  // (keyboard navigation in both "+" and "/" modes), so the list — which can
  // be taller than its `max-h` and scroll — follows the active item.
  const menuOpen = mode !== null && (mode === "plus" || slashHasMatches);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const active = menuRef.current?.querySelector<HTMLElement>(
      `[id="${listboxId}-opt-${safeActive}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [menuOpen, safeActive, listboxId]);

  const openPlusMenu = useCallback(() => {
    setActiveIndex(0);
    setPlusOpen(true);
  }, []);

  const onMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const len = flatTools.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (len > 0) {
          setActiveIndex((index) => Math.min(index + 1, len - 1));
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (len > 0) {
          setActiveIndex((index) => Math.max(index - 1, 0));
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const tool = flatTools[safeActive];
        if (tool) {
          commit(tool);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        editor.focus();
      }
    },
    [flatTools, safeActive, commit, closeMenu, editor],
  );

  if (typeof document === "undefined") {
    return null;
  }

  const open = menuOpen;
  const anchorRect = blockRect;
  const rootRect = editor.getRootElement()?.getBoundingClientRect() ?? null;
  const gutterLeft = rootRect ? leftGutterButtonLeft(rootRect) : null;
  const position =
    anchorRect !== null
      ? {
          top: anchorRect.bottom + MENU_GAP,
          left:
            mode === "plus" && rootRect !== null
              ? rootRect.left
              : anchorRect.left,
        }
      : { top: -1000, left: -1000 };

  // Running index across sections, so keyboard selection lines up with render.
  let runningIndex = 0;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {showGutter && blockRect !== null && gutterLeft !== null ? (
            <motion.button
              key="insert-plus"
              type="button"
              aria-label="Insert block"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openPlusMenu}
              initial={popMotion.initial}
              animate={popMotion.animate}
              exit={popMotion.exit}
              transition={popMotion.transition}
              style={{
                top:
                  blockRect.top +
                  blockRect.height / 2 -
                  DOCUMENT_GUTTER_BUTTON_SIZE / 2,
                left: gutterLeft,
              }}
              className={cx("fixed z-raised", GUTTER_BUTTON)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
            </motion.button>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}

      <FloatingSurface
        open={open}
        onClose={() => {
          closeMenu();
          editor.focus();
        }}
        position={position}
        role="presentation"
        layer="canvas"
        radius="lg"
        elevation="overlay"
        keepSelection
        // The "/" flow closes via the snapshot losing its trigger; only the
        // focus-trapped "+" flow needs Escape / click-away handled here.
        closeOnEscape={plusOpen}
        closeOnClickAway={plusOpen}
      >
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Insert block or visual"
          aria-activedescendant={
            flatTools.length > 0 ? optionId(safeActive) : undefined
          }
          tabIndex={-1}
          onKeyDown={plusOpen ? onMenuKeyDown : undefined}
          className="h-80 w-64 overflow-auto p-1 outline-none"
        >
          {flatTools.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--ds-text-muted,#71717a)]">
              No matches
            </div>
          ) : (
            sections.map((section) => (
              <PopoverSection key={section.id} title={section.label}>
                {section.tools.map((tool) => {
                  const index = runningIndex;
                  runningIndex += 1;
                  const isActive = index === safeActive;
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      id={optionId(index)}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commit(tool)}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-[var(--ds-radius-md,10px)] px-2.5 py-1.5 text-left transition-colors",
                        isActive
                          ? "bg-[var(--ds-accent,#6366f1)] text-[var(--ds-text-on-accent,#ffffff)]"
                          : "text-[var(--ds-text-primary,#18181b)] hover:bg-[var(--ds-state-hover,rgba(0,0,0,0.05))]",
                      )}
                    >
                      <span
                        className={cx(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm,8px)]",
                          isActive
                            ? "bg-ds-inverse-state-hover"
                            : "bg-[var(--ds-surface-raised,#f4f4f5)] text-[var(--ds-text-muted,#71717a)]",
                        )}
                      >
                        {Icon ? (
                          <Icon aria-hidden="true" className="h-4 w-4" />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {tool.label}
                        </span>
                        {tool.description ? (
                          <span
                            className={cx(
                              "truncate text-xs",
                              isActive
                                ? "text-ds-inverse-muted"
                                : "text-[var(--ds-text-muted,#71717a)]",
                            )}
                          >
                            {tool.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </PopoverSection>
            ))
          )}
        </div>
      </FloatingSurface>
    </>
  );
}
