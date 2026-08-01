"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
} from "lexical";
import {
  AlignCenter,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { FOCUS_RING, GUTTER_BUTTON } from "@/components/ui/tokens";
import { usePopMotion } from "@/components/motion/reveal";
import { Button, FloatingSurface, IconButton, Tooltip } from "@/components/ui";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cx } from "@/components/ui/tokens";
import { GeneratedCandidatesPanel } from "@/components/visual/generated-candidates-panel";
import { useEditorContext } from "@/lib/lexical/editor-context";
import { VISUAL_KIND_META } from "@/lib/lexical/tool-registry";
import {
  VISUAL_KINDS,
  type Visual,
  type VisualKind,
} from "@/lib/visual/schema";
import { type Orientation, type DetailLevel } from "@/lib/ai/prompt";
import { useIsPointerFine } from "@/lib/pointer";
import { emitProductTelemetry } from "@/lib/telemetry/product";

import {
  DOCUMENT_GUTTER_BUTTON_SIZE,
  leftGutterButtonLeft,
} from "./document-gutter";
import { $createVisualNode } from "@/lib/lexical/visual-node";
import {
  DEFAULT_EXPANDED_VISUAL_CATEGORIES,
  type GenOptions,
  MAX_GENERATED_VISUALS_PER_SECTION,
  VISUAL_KIND_CATEGORY,
  VISUAL_KIND_CATEGORY_ORDER,
  type VisualResultSectionId,
  useVisualGeneration,
  visualResultSectionForType,
} from "./use-visual-generation";

// Top-level block types that carry text worth turning into a visual.
const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "quote", "list"]);

const PANEL_GAP = 8;

type BlockInfo = {
  key: string;
  anchorTop: number;
  anchorHeight: number;
  gutterLeft: number;
  text: string;
  sourceKind: "block" | "selection";
};

function resolveAnchorRect(blockElement: HTMLElement): {
  top: number;
  height: number;
} {
  const blockRect = blockElement.getBoundingClientRect();
  return {
    top: blockRect.top,
    height: blockRect.height,
  };
}

function textBlockAtY(root: HTMLElement, clientY: number): HTMLElement | null {
  const blocks = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  let nearest: { element: HTMLElement; distance: number } | null = null;
  for (const element of blocks) {
    const rect = element.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return element;
    }
    const distance = Math.min(
      Math.abs(clientY - rect.top),
      Math.abs(clientY - rect.bottom),
    );
    if (!nearest || distance < nearest.distance) {
      nearest = { element, distance };
    }
  }
  return nearest && nearest.distance <= 24 ? nearest.element : null;
}

const ORIENTATION_OPTIONS: ReadonlyArray<{
  value: Orientation;
  label: string;
  icon?: React.ReactNode;
}> = [
  {
    value: "vertical",
    label: "Portrait",
    icon: <AlignVerticalSpaceAround aria-hidden="true" className="h-3 w-3" />,
  },
  {
    value: "auto",
    label: "Auto",
    icon: <Maximize2 aria-hidden="true" className="h-3 w-3" />,
  },
  {
    value: "horizontal",
    label: "Landscape",
    icon: <AlignHorizontalSpaceAround aria-hidden="true" className="h-3 w-3" />,
  },
  {
    value: "square",
    label: "Square",
    icon: <AlignCenter aria-hidden="true" className="h-3 w-3" />,
  },
];

const DETAIL_LEVEL_OPTIONS: ReadonlyArray<{
  value: DetailLevel | "auto";
  label: string;
}> = [
  { value: "summary", label: "Summary" },
  { value: "auto", label: "Auto" },
  { value: "detailed", label: "Detailed" },
];

const AUTO_TYPE_SEARCH = "auto automatic recommended generated";

type VisualKindCategoryId = (typeof VISUAL_KIND_CATEGORY_ORDER)[number]["id"];

function visualKindMatchesQuery(kind: VisualKind, query: string): boolean {
  if (query === "") {
    return true;
  }
  const meta = VISUAL_KIND_META[kind];
  return [meta.label, meta.description, ...meta.keywords].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function groupVisualKinds(kinds: readonly VisualKind[]) {
  const buckets = new Map<VisualKindCategoryId, VisualKind[]>();
  for (const kind of kinds) {
    const category = VISUAL_KIND_CATEGORY[kind] ?? "more";
    const current = buckets.get(category) ?? [];
    current.push(kind);
    buckets.set(category, current);
  }

  return VISUAL_KIND_CATEGORY_ORDER.flatMap((category) => {
    const categoryKinds = buckets.get(category.id) ?? [];
    return categoryKinds.length > 0
      ? [{ ...category, kinds: categoryKinds }]
      : [];
  });
}

function elementFromNode(target: Node | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  return target?.parentElement ?? null;
}

function isVisualChromeTarget(target: Node | null): boolean {
  return (
    elementFromNode(target)?.closest(
      "[data-visual-chrome],[data-lexical-visual-id]",
    ) !== null
  );
}

/**
 * Text-to-visual "spark" affordance for the Lexical editor (US-010). Selecting
 * text or hovering/focusing a text block reveals a gutter button that POSTs the
 * selected/block text to `/api/generate` and shows candidate variations in a
 * panel. Choosing a candidate inserts a {@link VisualNode} (US-009) directly
 * AFTER the selection end block or source block, so it serializes into
 * `contentJson` and re-renders on reload.
 *
 * The control is gated on the editor being editable (which mirrors
 * canEdit && collab-ready via the editor's `EditableGate`), shows one block at a
 * time, and adds no layout shift (the button is an absolutely/fixed-positioned
 * portal in the gutter). Generation errors are non-blocking and retryable.
 */
export function BlockSparkPlugin() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const isPointerFine = useIsPointerFine();

  const [editable, setEditable] = useState(() => editor.isEditable());
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [openTarget, setOpenTarget] = useState<BlockInfo | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const {
    status,
    error,
    errorSection,
    creditError,
    activeGenerationSection,
    generatedVisualsBySection,
    genOptions,
    setGenOptions,
    generate: generateVisuals,
    resetGeneration,
    stampGeneratedVisual,
  } = useVisualGeneration();
  const [showOptions, setShowOptions] = useState(false);
  const [hoveringVisual, setHoveringVisual] = useState(false);
  const [visualQuery, setVisualQuery] = useState("");
  const [rememberChoices, setRememberChoices] = useState(false);
  const [expandedVisualCategories, setExpandedVisualCategories] = useState<
    Record<string, boolean>
  >(DEFAULT_EXPANDED_VISUAL_CATEGORIES);
  const popMotion = usePopMotion();

  // Keeps the gutter button alive while the pointer travels from the block to
  // the button (which lives outside the editable root) or while the panel is
  // open. Without this the button vanishes before it can be clicked.
  const keepRef = useRef(false);
  const openRef = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    openRef.current = openKey !== null;
  });

  const cancelClear = useCallback(() => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }, []);

  const keepAlive = useCallback(() => {
    keepRef.current = true;
    cancelClear();
  }, [cancelClear]);

  useEffect(() => {
    return editor.registerEditableListener((value) => setEditable(value));
  }, [editor]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) {
        clearTimeout(clearTimer.current);
      }
    };
  }, []);

  // Resolve the top-level text block under a DOM target and capture its rect.
  const resolveBlock = useCallback(
    (target: Node | null, clientY?: number): BlockInfo | null => {
      const root = editor.getRootElement();
      if (!root || !(target instanceof Node)) {
        return null;
      }
      // Walk up to the direct child of the editable root.
      const targetElement =
        target instanceof HTMLElement ? target : target.parentElement;
      let el: HTMLElement | null = targetElement;
      while (el && el.parentElement !== root) {
        el = el.parentElement;
      }
      if (!targetElement || !el || el.parentElement !== root) {
        if (typeof clientY === "number") {
          el = textBlockAtY(root, clientY);
        }
      }
      if (!el || el.parentElement !== root) {
        return null;
      }
      const domEl = el;
      const info = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(domEl);
        if (node === null) {
          return null;
        }
        const top = node.getTopLevelElement();
        if (top === null || !TEXT_BLOCK_TYPES.has(top.getType())) {
          return null;
        }
        const text = top.getTextContent().trim();
        if (text === "") {
          return null;
        }
        return { key: top.getKey(), text };
      });
      if (info === null) {
        return null;
      }
      const gutterLeft = leftGutterButtonLeft(root.getBoundingClientRect());
      if (gutterLeft === null) {
        return null;
      }
      const anchor = resolveAnchorRect(domEl);
      return {
        key: info.key,
        text: info.text,
        sourceKind: "block",
        anchorTop: anchor.top,
        anchorHeight: anchor.height,
        gutterLeft,
      };
    },
    [editor],
  );

  // Track the hovered/focused block. The panel stays anchored to its block
  // while open, so we stop retargeting once a generation panel is shown. We use
  // `registerRootListener` so the handlers attach to the contenteditable root as
  // soon as it mounts (it may be null on first render).
  useEffect(() => {
    const onPointer = (event: Event) => {
      if (!editor.isEditable()) {
        return;
      }
      const target = event.target as Node | null;
      if (isVisualChromeTarget(target)) {
        cancelClear();
        setHoveringVisual(true);
        if (!openRef.current) {
          setBlock(null);
        }
        return;
      }
      setHoveringVisual(false);
      if (openRef.current) {
        return;
      }
      const next = resolveBlock(
        target,
        event instanceof MouseEvent ? event.clientY : undefined,
      );
      if (next !== null) {
        cancelClear();
        setBlock(next);
      } else {
        setBlock(null);
      }
    };

    // Debounce clearing so the pointer can travel from the block to the gutter
    // button (which lives outside the editable root); entering the button or
    // panel cancels the pending clear via `keepAlive`.
    const onLeave = () => {
      if (openRef.current) {
        return;
      }
      cancelClear();
      setHoveringVisual(false);
      clearTimer.current = setTimeout(() => {
        if (!keepRef.current && !openRef.current) {
          setBlock(null);
        }
      }, 200);
    };

    return editor.registerRootListener((root, prevRoot) => {
      if (prevRoot !== null) {
        prevRoot.removeEventListener("mousemove", onPointer);
        prevRoot.removeEventListener("pointerover", onPointer);
        prevRoot.removeEventListener("focusin", onPointer);
        prevRoot.removeEventListener("mouseleave", onLeave);
      }
      if (root !== null) {
        root.addEventListener("mousemove", onPointer);
        root.addEventListener("pointerover", onPointer);
        root.addEventListener("focusin", onPointer);
        root.addEventListener("mouseleave", onLeave);
      }
    });
  }, [editor, resolveBlock, cancelClear]);

  const closePanel = useCallback(() => {
    setOpenTarget(null);
    setOpenKey(null);
    resetGeneration(rememberChoices);
    keepRef.current = false;
    setHoveringVisual(false);
    setShowOptions(false);
    setVisualQuery("");
  }, [rememberChoices, resetGeneration]);

  useEffect(() => {
    const dismissSpark = () => {
      cancelClear();
      keepRef.current = false;
      setBlock(null);
      closePanel();
    };

    window.addEventListener("scroll", dismissSpark, true);
    window.addEventListener("resize", dismissSpark);
    return () => {
      window.removeEventListener("scroll", dismissSpark, true);
      window.removeEventListener("resize", dismissSpark);
    };
  }, [cancelClear, closePanel]);

  const toggleVisualCategory = useCallback((categoryId: string) => {
    setExpandedVisualCategories((current) => ({
      ...current,
      [categoryId]: !current[categoryId],
    }));
  }, []);

  const generate = useCallback(
    async (target: BlockInfo, opts: GenOptions) => {
      const section = visualResultSectionForType(opts.type);
      setOpenTarget(target);
      setOpenKey(target.key);
      setExpandedVisualCategories((current) => ({
        ...current,
        [section === "ai" ? "ai" : section]: true,
      }));
      await generateVisuals(target, {
        options: opts,
        append: true,
        limit: MAX_GENERATED_VISUALS_PER_SECTION,
      });
    },
    [generateVisuals],
  );

  const insertVisual = useCallback(
    (visual: Visual) => {
      const targetKey = openKey;
      if (targetKey === null) {
        return;
      }
      // Stamp sourceText so the visual remembers the text it was generated from.
      const toInsert = stampGeneratedVisual(visual);
      emitProductTelemetry("product.ai.visual.applied", {
        sourceKind: openTarget?.sourceKind ?? "block",
        visualKind: visual.type,
      });
      editor.update(() => {
        const top = $getNodeByKey(targetKey);
        if (top === null || !$isElementNode(top)) {
          return;
        }
        top.insertAfter($createVisualNode(toInsert));
      });
      closePanel();
      editor.focus();
    },
    [editor, openKey, openTarget, closePanel, stampGeneratedVisual],
  );

  if (typeof document === "undefined" || !editable) {
    return null;
  }

  const selectionText =
    ctx.kind === "range" ? (ctx.selectionText?.trim() ?? "") : "";
  const selectionRect = ctx.rects.selection;
  const selectionInsertKey = ctx.selectionEndBlockKey ?? ctx.blockKey;
  const rootRect = editor.getRootElement()?.getBoundingClientRect() ?? null;
  const selectionGutterLeft = rootRect ? leftGutterButtonLeft(rootRect) : null;
  const selectionTarget: BlockInfo | null =
    selectionText !== "" &&
    selectionRect !== null &&
    selectionInsertKey !== undefined &&
    selectionGutterLeft !== null
      ? {
          key: selectionInsertKey,
          text: selectionText,
          sourceKind: "selection",
          anchorTop: selectionRect.top,
          anchorHeight: selectionRect.height,
          gutterLeft: selectionGutterLeft,
        }
      : null;
  const displayTarget = selectionTarget ?? block;
  const panelTarget = openKey !== null ? openTarget : null;
  const normalizedVisualQuery = visualQuery.trim().toLowerCase();
  const showAutoType =
    normalizedVisualQuery === "" ||
    AUTO_TYPE_SEARCH.includes(normalizedVisualQuery);
  const filteredVisualKinds = VISUAL_KINDS.filter((kind) =>
    visualKindMatchesQuery(kind, normalizedVisualQuery),
  );
  const visualGroups = groupVisualKinds(filteredVisualKinds);
  const isSearchingVisuals = normalizedVisualQuery !== "";

  const renderGeneratedVisuals = (section: VisualResultSectionId) => {
    const sectionVisuals = generatedVisualsBySection[section] ?? [];
    const sectionLoading =
      status === "loading" && activeGenerationSection === section;
    const sectionError = errorSection === section ? error : null;

    if (
      !sectionLoading &&
      sectionError === null &&
      sectionVisuals.length === 0
    ) {
      return null;
    }

    return (
      <GeneratedCandidatesPanel
        candidates={sectionVisuals}
        status={sectionLoading ? "loading" : "idle"}
        error={sectionError}
        creditError={creditError}
        variant="compact"
        onRetry={() =>
          panelTarget !== null
            ? void generate(panelTarget, genOptions)
            : undefined
        }
        onChooseCandidate={insertVisual}
      />
    );
  };

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {/* Gutter spark button: hidden on touch/coarse-pointer viewports
              since it relies on hover and is a desktop-only affordance. */}
          {isPointerFine && displayTarget !== null && !hoveringVisual ? (
            <motion.button
              key="block-spark"
              type="button"
              aria-label={
                selectionTarget !== null
                  ? "Generate visual for selected text"
                  : "Generate visual for this block"
              }
              aria-expanded={openKey === displayTarget.key}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={keepAlive}
              onMouseLeave={() => {
                keepRef.current = false;
              }}
              onClick={() =>
                openKey === displayTarget.key
                  ? closePanel()
                  : void generate(displayTarget, genOptions)
              }
              initial={popMotion.initial}
              animate={popMotion.animate}
              exit={popMotion.exit}
              transition={popMotion.transition}
              style={{
                top:
                  displayTarget.anchorTop +
                  displayTarget.anchorHeight / 2 -
                  DOCUMENT_GUTTER_BUTTON_SIZE / 2,
                left: displayTarget.gutterLeft,
              }}
              className={cx("fixed z-raised", GUTTER_BUTTON)}
            >
              <Sparkles aria-hidden="true" className="h-6 w-6" />
            </motion.button>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}

      <FloatingSurface
        open={openKey !== null && panelTarget !== null}
        onClose={closePanel}
        position={{ top: PANEL_GAP, left: PANEL_GAP }}
        role="dialog"
        aria-label="Insert a visual for this block"
        layer="canvas"
        radius="lg"
        elevation="overlay"
        closeOnClickAway={false}
      >
        <div
          onMouseEnter={keepAlive}
          className="flex w-[21rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden"
          style={{ height: "calc(100vh - 1rem)" }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--ds-text-muted,#6f7d83)]"
              />
              <span className="truncate text-base font-semibold text-[var(--ds-text-primary,#15171a)]">
                Visuals
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                aria-label="Generation options"
                size="sm"
                active={showOptions}
                onClick={() => setShowOptions((value) => !value)}
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              </IconButton>
              <IconButton aria-label="Close" size="sm" onClick={closePanel}>
                <X aria-hidden="true" className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {showOptions ? (
              <div className="shrink-0 space-y-2 border-b border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] px-3 py-2">
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-[var(--ds-text-secondary,#52525b)]">
                    Orientation
                  </div>
                  <SegmentedControl
                    aria-label="Visual orientation"
                    size="sm"
                    options={ORIENTATION_OPTIONS}
                    value={genOptions.orientation}
                    onChange={(value) =>
                      setGenOptions((option) => ({
                        ...option,
                        orientation: value,
                      }))
                    }
                    className="w-full overflow-x-auto"
                  />
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-semibold text-[var(--ds-text-secondary,#52525b)]">
                    Detail
                  </div>
                  <SegmentedControl
                    aria-label="Detail level"
                    size="sm"
                    options={DETAIL_LEVEL_OPTIONS}
                    value={genOptions.detailLevel}
                    onChange={(value) =>
                      setGenOptions((option) => ({
                        ...option,
                        detailLevel: value,
                      }))
                    }
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ds-text-secondary,#52525b)]">
                    <input
                      type="checkbox"
                      checked={genOptions.stayCloserToText}
                      onChange={(event) =>
                        setGenOptions((option) => ({
                          ...option,
                          stayCloserToText: event.target.checked,
                        }))
                      }
                      className={cx(
                        "h-4 w-4 cursor-pointer rounded accent-[var(--ds-accent,#6366f1)]",
                        FOCUS_RING,
                      )}
                    />
                    <span>Stay closer to my text</span>
                  </label>

                  <div className="flex items-center justify-between gap-3">
                    <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-[var(--ds-text-secondary,#52525b)]">
                      <input
                        type="checkbox"
                        checked={rememberChoices}
                        onChange={(event) =>
                          setRememberChoices(event.target.checked)
                        }
                        className={cx(
                          "h-4 w-4 cursor-pointer rounded accent-[var(--ds-accent,#6366f1)]",
                          FOCUS_RING,
                        )}
                      />
                      <span className="truncate">Remember my choices</span>
                    </label>

                    <Button
                      size="sm"
                      variant="solid"
                      leadingIcon={
                        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                      }
                      onClick={() =>
                        panelTarget !== null
                          ? void generate(panelTarget, genOptions)
                          : undefined
                      }
                      disabled={status === "loading"}
                      className="shrink-0"
                    >
                      {status === "loading" ? "Applying…" : "Apply"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5 pt-2.5">
              <div className="relative mb-2">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-text-muted,#6f7d83)]"
                />
                <input
                  type="search"
                  value={visualQuery}
                  onChange={(event) => setVisualQuery(event.target.value)}
                  placeholder="Search [e.g. Mindmap...]"
                  aria-label="Search visual types"
                  className={cx(
                    "h-8 w-full rounded-[var(--ds-radius-md,8px)] border border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] bg-[var(--ds-surface-base,#ffffff)] pl-9 pr-3 text-sm text-[var(--ds-text-primary,#15171a)] outline-none placeholder:text-[var(--ds-text-muted,#a1a1aa)]",
                    FOCUS_RING,
                  )}
                />
              </div>

              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-[var(--ds-text-primary,#15171a)]">
                  Categories
                </h3>

                {showAutoType || visualGroups.length > 0 ? (
                  <div className="divide-y divide-[var(--ds-border-subtle,rgba(0,0,0,0.08))]">
                    {showAutoType ? (
                      <div className="py-2 first:pt-0">
                        <button
                          type="button"
                          aria-expanded={
                            isSearchingVisuals ||
                            expandedVisualCategories.ai !== false
                          }
                          onClick={() => toggleVisualCategory("ai")}
                          className={cx(
                            "flex w-full items-center justify-between gap-2 rounded-[var(--ds-radius-sm,6px)] py-0.5 text-left text-sm font-semibold text-[var(--ds-text-primary,#15171a)]",
                            FOCUS_RING,
                          )}
                        >
                          <span>AI visuals</span>
                          {isSearchingVisuals ||
                          expandedVisualCategories.ai !== false ? (
                            <ChevronDown
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0"
                            />
                          ) : (
                            <ChevronRight
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0"
                            />
                          )}
                        </button>

                        {isSearchingVisuals ||
                        expandedVisualCategories.ai !== false ? (
                          <>
                            {renderGeneratedVisuals("ai")}
                            <div
                              role="radiogroup"
                              aria-label="AI generated visual types"
                              className="mt-1.5 flex flex-wrap gap-1.5"
                            >
                              <Tooltip label="Auto" side="bottom">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={genOptions.type === "auto"}
                                  aria-label="Auto visual type"
                                  onClick={() => {
                                    const next: GenOptions = {
                                      ...genOptions,
                                      type: "auto",
                                    };
                                    setGenOptions(next);
                                    if (panelTarget !== null) {
                                      void generate(panelTarget, next);
                                    }
                                  }}
                                  className={cx(
                                    "flex h-9 w-9 items-center justify-center rounded-[var(--ds-radius-md,8px)] text-[var(--ds-text-muted,#6f7d83)] transition-colors",
                                    genOptions.type === "auto"
                                      ? "bg-[var(--ds-accent,#6366f1)] text-[var(--ds-text-on-accent,#ffffff)]"
                                      : "hover:bg-[var(--ds-state-hover,rgba(0,0,0,0.06))] hover:text-[var(--ds-text-primary,#15171a)]",
                                    FOCUS_RING,
                                  )}
                                >
                                  <Sparkles
                                    aria-hidden="true"
                                    className="h-4 w-4"
                                  />
                                </button>
                              </Tooltip>
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {visualGroups.map((group) => {
                      const open =
                        isSearchingVisuals ||
                        expandedVisualCategories[group.id] === true;
                      return (
                        <div key={group.id} className="py-2 first:pt-0">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => toggleVisualCategory(group.id)}
                            className={cx(
                              "flex w-full items-center justify-between gap-2 rounded-[var(--ds-radius-sm,6px)] py-0.5 text-left text-sm font-semibold text-[var(--ds-text-primary,#15171a)]",
                              FOCUS_RING,
                            )}
                          >
                            <span>{group.label}</span>
                            {open ? (
                              <ChevronDown
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0"
                              />
                            ) : (
                              <ChevronRight
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0"
                              />
                            )}
                          </button>

                          {open ? (
                            <>
                              {renderGeneratedVisuals(group.id)}
                              <div
                                role="radiogroup"
                                aria-label={`${group.label} generated visual types`}
                                className="mt-1.5 flex flex-wrap gap-1.5"
                              >
                                {group.kinds.map((kind) => {
                                  const meta = VISUAL_KIND_META[kind];
                                  const Icon = meta.icon;
                                  const active = genOptions.type === kind;
                                  return (
                                    <Tooltip
                                      key={kind}
                                      label={meta.label}
                                      side="bottom"
                                    >
                                      <button
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        aria-label={meta.label}
                                        onClick={() => {
                                          const next = {
                                            ...genOptions,
                                            type: kind,
                                          };
                                          setGenOptions(next);
                                          if (panelTarget !== null) {
                                            void generate(panelTarget, next);
                                          }
                                        }}
                                        className={cx(
                                          "flex h-9 w-9 items-center justify-center rounded-[var(--ds-radius-md,8px)] text-[var(--ds-text-muted,#6f7d83)] transition-colors",
                                          active
                                            ? "bg-[var(--ds-accent,#6366f1)] text-[var(--ds-text-on-accent,#ffffff)]"
                                            : "hover:bg-[var(--ds-state-hover,rgba(0,0,0,0.06))] hover:text-[var(--ds-text-primary,#15171a)]",
                                          FOCUS_RING,
                                        )}
                                      >
                                        <Icon
                                          aria-hidden="true"
                                          className="h-4 w-4"
                                        />
                                      </button>
                                    </Tooltip>
                                  );
                                })}
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-[var(--ds-radius-md,8px)] bg-[var(--ds-surface-raised,#f4f4f5)] px-3 py-2 text-sm text-[var(--ds-text-muted,#6f7d83)]">
                    No visual types match this search.
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      </FloatingSurface>
    </>
  );
}
