"use client";

import { Check, Copy, Download, Share2 } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $nodesOfType } from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import { useCardMotion } from "@/components/motion/reveal";
import { FOCUS_RING } from "@/components/ui/tokens";
import { contentViewBox, edgeSegments, nodeBoxes } from "@/lib/visual/layout";
import { VisualRenderer } from "@/components/visual/visual-renderer";
import { safeParseVisual, type Visual } from "@/lib/visual/schema";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportPNG,
  downloadBlob,
} from "@/lib/visual/export";
import { sanitizeFilename } from "@/lib/visual/export-filename";
import { applySocialPresetToOptions } from "@/lib/visual/export-options";
import { applyElasticLayout } from "@/lib/visual/transforms";
import { applyBrand } from "@/lib/brand/transforms";
import type { BrandStyle } from "@/lib/brand/schema";
import { BRAND_WEB_FONTS } from "@/lib/brand/schema";
import {
  canCopyImageToClipboard,
  canWebShare,
} from "@/lib/share/social-intents";

import { useRegisterVisualSvg } from "@/components/editor/visual-svg-registry";
import { useRightSurface } from "./right-surface-context";

import { applyVisualCommand } from "@/lib/commands/visual-command-adapter";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";
import { useEditingSurface } from "./use-editing-surface";
import { VisualContextPopover } from "./visual-context-popover";
import { VisualEditor } from "./visual-editor";
import {
  $isVisualNode,
  $createVisualNode,
  VisualNode,
} from "@/lib/lexical/visual-node";
import { useVisualPanel } from "./visual-panel-context";

// Block types whose text content can serve as a visual's source anchor.
const SOURCE_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "quote",
  "list",
]);

type VisualQuickAction = "download" | "copy" | "share";

type VisualActionError = {
  action: VisualQuickAction;
  message: string;
};

/**
 * Interactive card for a {@link Visual} embedded in the Lexical editor (US-012).
 * Read-only by default; clicking it (when the editor is editable) opens the
 * contextual {@link VisualContextPopover} plus the in-card {@link VisualEditor}
 * — the single Phase-3 editing surface (type / theme / refine / typography /
 * per-element overrides).
 *
 * Visibility is local React state, not a Lexical `NodeSelection`. Under
 * real-time collaboration the `@lexical/yjs` binding discards programmatic
 * decorator `NodeSelection`s on commit (a decorator selection has no Yjs
 * relative-position representation, so it resets to null), which is why the
 * selection-driven popover never surfaced. Local state is the single source of
 * truth for visibility: click-away is scoped to the editor root (clicking other
 * document content — or another visual — closes this one, giving
 * single-active-visual semantics) and Escape / × close via the popover surface.
 *
 * Every edit writes back via `node.setVisual` inside an `editor.update`, a local
 * edit that persists through the debounced Lexical save (US-003) and the
 * mirrored `Visual` row (US-011). No NodeKey is ever persisted.
 */
export function VisualCard({
  nodeKey,
  visual,
  visualId,
}: {
  nodeKey: string;
  visual: Visual;
  visualId: string;
}) {
  const [editor] = useLexicalComposerContext();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SVGSVGElement | null>(null);
  const suppressPreviewClickRef = useRef(false);

  // Register this card's SVG getter in the document-level export registry so
  // the whole-document export can include every visual in reading order.
  useRegisterVisualSvg(visualId, () => rendererRef.current);

  const [editable, setEditable] = useState(() => editor.isEditable());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Whether this card's editing controls are open. Local state (not a Lexical
  // NodeSelection) so it survives collaborative updates — see the component doc.
  const [open, setOpen] = useState(false);

  // When the full-page SlideEditor is open it covers the whole screen, so the
  // inline floating overlay would be hidden behind it. The coordinator
  // suppresses the visual popover while the slide editor is active.
  const { suppressFloatPopover } = useRightSurface();

  // Visual/component controls render as an anchored popover on fine pointers
  // and in the sheet on coarse pointers.
  const editingSurface = useEditingSurface();

  // Current text content of the immediately preceding block (the likely anchor).
  // Updated on every editor state change so the popover can detect staleness.
  const [currentSourceText, setCurrentSourceText] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    const readSourceText = () => {
      editor.read(() => {
        const node = $getNodeByKey(nodeKey);
        if (node === null) {
          setCurrentSourceText(undefined);
          return;
        }
        const prev = node.getPreviousSibling();
        if (prev !== null && SOURCE_TEXT_BLOCK_TYPES.has(prev.getType())) {
          const text = prev.getTextContent().trim();
          setCurrentSourceText(text || undefined);
        } else {
          setCurrentSourceText(undefined);
        }
      });
    };
    readSourceText();
    return editor.registerUpdateListener(readSourceText);
  }, [editor, nodeKey]);

  const cardMotion = useCardMotion();

  const showControls = open && editable;

  useEffect(() => {
    return editor.registerEditableListener((value) => {
      setEditable(value);
      // Never leave stale editing UI open when the card becomes non-editable
      // (read-only access, or collaboration not yet ready).
      if (!value) {
        setOpen(false);
      }
    });
  }, [editor]);

  // Click-away + single-active-visual: a pointer-down inside the editor but
  // outside this card closes the controls. Scoped to the editor root so clicks
  // on the portaled popover and its nested pickers (which render outside the
  // editable root) keep the controls open; Escape and × close via the popover.
  useEffect(() => {
    if (!showControls) {
      return;
    }
    const root = editor.getRootElement();
    if (!root) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    root.addEventListener("mousedown", onPointerDown);
    return () => root.removeEventListener("mousedown", onPointerDown);
  }, [showControls, editor]);

  // Writes a new payload back to the node. This is a local edit, so the editor's
  // OnChangePlugin debounce-saves it into `contentJson` (US-003) and the save
  // action mirrors it to the `Visual` row (US-011). When `autoLayout` is on,
  // elastic layout is re-applied here so the canvas always grows to fit content.
  //
  // #507 exemption: this is the generic write-back seam (it receives an
  // already-computed Visual, not a typed intent), so it is not itself a command.
  // Discrete user-intent edits route through `handleCommand` / `applyVisualCommand`
  // before reaching this seam; non-command callers (repair/projection) pass a
  // Visual directly.
  const updateVisual = useCallback(
    (next: Visual) => {
      const toSave = applyElasticLayout(next);
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isVisualNode(node)) {
          node.setVisual(toSave);
        }
      });
    },
    [editor, nodeKey],
  );

  // Routes a typed visual command payload through the visual command executor,
  // then writes the result back via node.setVisual (issue #471). Falls back to
  // updateVisual when the command fails so the editor remains functional.
  const handleCommand = useCallback(
    (payload: VisualCommandPayload, coalesceKey?: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isVisualNode(node)) {
          return;
        }
        const current = node.getVisual();
        const result = applyVisualCommand(
          current,
          visualId,
          payload,
          undefined,
          coalesceKey,
        );
        if (result.ok) {
          node.setVisual(applyElasticLayout(result.visual));
        }
        // On failure the visual is unchanged — no-op is the safe default.
      });
    },
    [editor, nodeKey, visualId],
  );

  // Removes this visual block from the document (US-013).
  const removeVisual = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isVisualNode(node)) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

  // Deletes the selected graph node. User-intent edit (#471/#507): routed
  // through the visual command executor so the deletion is validated and
  // carries command metadata. The `nodes.length <= 1` guard preserves the
  // existing UX (never delete the last node). On command failure the visual is
  // left unchanged — invalid command output is never persisted.
  const removeSelectedNode = useCallback(() => {
    const id = selectedNodeId;
    if (!id) {
      return;
    }
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isVisualNode(node)) {
        return;
      }
      const current = node.getVisual();
      if (current.nodes.length <= 1) {
        return;
      }
      const result = applyVisualCommand(current, visualId, {
        op: "visual.delete_node",
        nodeId: id,
      });
      if (result.ok) {
        node.setVisual(applyElasticLayout(result.visual));
      }
    });
    setSelectedNodeId(null);
  }, [editor, nodeKey, selectedNodeId, visualId]);

  // Duplicates this visual block by inserting a new VisualNode with the same
  // payload immediately after the current node. A fresh visualId is generated
  // by $createVisualNode so the duplicate is tracked independently. Collab-safe:
  // the mutation goes through editor.update() → node.insertAfter().
  //
  // #507 exemption: this is a document-structure edit (inserts a new Lexical
  // block), not a visual-content command. There is no `visual.*` op for block
  // duplication, so it intentionally bypasses the visual command executor.
  const duplicateVisual = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isVisualNode(node)) {
        const copy = $createVisualNode(node.getVisual());
        node.insertAfter(copy);
      }
    });
  }, [editor, nodeKey]);

  /**
   * Applies a brand to ALL VisualNodes in the document via a single
   * `editor.update()` call using `$nodesOfType` to find all visual nodes.
   * Yjs-safe: mutations go through `node.setVisual()` as a local edit.
   *
   * Fonts referenced by the brand are injected as <link> tags so they load
   * immediately in the editor canvas.
   *
   * #507 exemption: this is a cross-visual, document-wide operation (it mutates
   * every VisualNode in the document at once) with no single-visual `visual.*`
   * command op. Per-visual brand application still flows through the executor
   * (`visual.apply_theme`); this bulk path is intentionally direct.
   */
  const applyBrandToAll = useCallback(
    (brand: BrandStyle) => {
      // Inject Google Font if needed
      if (brand.fontFamily) {
        const match = BRAND_WEB_FONTS.find(
          (f) => f.cssFamily === brand.fontFamily,
        );
        if (match) {
          const id = `gfont-brand-${match.id}`;
          if (!document.getElementById(id)) {
            const link = document.createElement("link");
            link.id = id;
            link.rel = "stylesheet";
            link.href = match.url;
            document.head.appendChild(link);
          }
        }
      }

      editor.update(() => {
        const nodes = $nodesOfType(VisualNode);
        for (const node of nodes) {
          node.setVisual(
            applyElasticLayout(applyBrand(node.getVisual(), brand)),
          );
        }
      });
    },
    [editor],
  );

  // Opens this card's editing controls. Visibility is local state; the
  // editor-root click-away above closes any other open visual, giving
  // single-active-visual semantics without a (collab-stripped) NodeSelection.
  const selectVisual = useCallback((nodeId?: string | null) => {
    setSelectedNodeId(nodeId ?? null);
    setSelectedEdgeId(null);
    setOpen(true);
  }, []);

  const selectPreviewEdge = useCallback((edgeId: string) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edgeId);
    setOpen(true);
  }, []);

  const selectPreviewElement = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target as Element | null;
      const nodeId = target?.getAttribute("data-preview-node-id");
      const edgeId = target?.getAttribute("data-preview-edge-id");
      if (nodeId || edgeId) {
        event.preventDefault();
        event.stopPropagation();
        suppressPreviewClickRef.current = true;
      }
      if (nodeId) {
        selectVisual(nodeId);
      } else if (edgeId) {
        selectPreviewEdge(edgeId);
      }
    },
    [selectPreviewEdge, selectVisual],
  );

  // Closes the controls (Escape / × / click-away).
  const closeControls = useCallback(() => {
    setOpen(false);
  }, []);

  // Sync the close callback and selected-node id with the editing bottom-sheet
  // (touch fallback) so it can render the visual controls and forward close
  // events.
  const {
    setActiveVisual,
    setOnClose,
    setSelectedNodeId: setPanelSelectedNodeId,
  } = useVisualPanel();

  useEffect(() => {
    if (showControls) {
      setActiveVisual({ nodeKey, visualId });
      setOnClose(closeControls);
      setPanelSelectedNodeId(selectedNodeId);
      return () => {
        setActiveVisual(null);
        setOnClose(null);
        setPanelSelectedNodeId(null);
      };
    }
    setActiveVisual(null);
    setOnClose(null);
    setPanelSelectedNodeId(null);
  }, [
    showControls,
    closeControls,
    nodeKey,
    selectedNodeId,
    setActiveVisual,
    setOnClose,
    setPanelSelectedNodeId,
    visualId,
  ]);

  // Parse once per `visual` identity. An unmemoized parse returns a fresh object
  // (and `nodes` array) every render, which would make every downstream consumer
  // that depends on it (the anchor-reporting effect here, the popover's
  // `selectedNode`/reposition effect) re-run on every render and loop with their
  // own setState calls.
  const parsed = useMemo(() => safeParseVisual(visual), [visual]);

  const quickActionRef = useRef<VisualQuickAction | null>(null);
  const mountedRef = useRef(true);
  const [activeQuickAction, setActiveQuickAction] =
    useState<VisualQuickAction | null>(null);
  const [actionError, setActionError] = useState<VisualActionError | null>(
    null,
  );
  const [actionStatus, setActionStatus] = useState("");
  const [copyImageState, setCopyImageState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [nativeShareState, setNativeShareState] = useState<
    "idle" | "sharing" | "error"
  >("idle");
  const copyImageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      quickActionRef.current = null;
      if (copyImageTimerRef.current !== null) {
        clearTimeout(copyImageTimerRef.current);
        copyImageTimerRef.current = null;
      }
    };
  }, []);

  const beginQuickAction = useCallback((action: VisualQuickAction) => {
    if (quickActionRef.current !== null) {
      return false;
    }

    quickActionRef.current = action;
    if (copyImageTimerRef.current !== null) {
      clearTimeout(copyImageTimerRef.current);
      copyImageTimerRef.current = null;
    }
    setActiveQuickAction(action);
    setActionError(null);
    setActionStatus("");
    setCopyImageState(action === "copy" ? "copying" : "idle");
    setNativeShareState(action === "share" ? "sharing" : "idle");
    return true;
  }, []);

  const finishQuickAction = useCallback((action: VisualQuickAction) => {
    if (quickActionRef.current !== action) {
      return;
    }
    quickActionRef.current = null;
    if (mountedRef.current) {
      setActiveQuickAction(null);
    }
  }, []);

  const ownsQuickAction = useCallback(
    (action: VisualQuickAction) =>
      mountedRef.current && quickActionRef.current === action,
    [],
  );

  const dismissActionError = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setActionError(null);
    setCopyImageState("idle");
    setNativeShareState("idle");
  }, []);

  // Quick-download: export the visual as PNG on the download icon click.
  const quickDownload = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      const svg = rendererRef.current;
      if (!svg || !parsed.success) return;
      if (!beginQuickAction("download")) return;
      const visualData = parsed.data;
      try {
        const opts = {
          ...DEFAULT_EXPORT_OPTIONS,
          aspectRatio: visualData.aspectRatio,
        };
        const blob = await exportPNG(svg, opts);
        if (!ownsQuickAction("download")) return;
        if (!blob) {
          throw new Error("exportPNG returned null");
        }
        const filename = sanitizeFilename(visualData.title ?? "") + ".png";
        downloadBlob(blob, filename);
        if (ownsQuickAction("download")) {
          setActionStatus("Visual download started.");
        }
      } catch {
        if (ownsQuickAction("download")) {
          setActionError({
            action: "download",
            message: "Visual download failed. Try again.",
          });
        }
      } finally {
        finishQuickAction("download");
      }
    },
    [beginQuickAction, finishQuickAction, ownsQuickAction, parsed],
  );

  // Copy image to clipboard.
  const copyImage = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      const svg = rendererRef.current;
      if (!svg || !beginQuickAction("copy")) return;
      try {
        const opts = applySocialPresetToOptions(
          "square",
          DEFAULT_EXPORT_OPTIONS,
        );
        const blob = await exportPNG(svg, opts);
        if (!ownsQuickAction("copy")) return;
        if (!blob) throw new Error("exportPNG returned null");
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        if (ownsQuickAction("copy")) {
          setCopyImageState("copied");
          setActionStatus("Visual image copied to the clipboard.");
          copyImageTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setCopyImageState("idle");
            }
            copyImageTimerRef.current = null;
          }, 2500);
        }
      } catch {
        if (ownsQuickAction("copy")) {
          setCopyImageState("error");
          setActionError({
            action: "copy",
            message: "Visual copy failed. Try again.",
          });
        }
      } finally {
        finishQuickAction("copy");
      }
    },
    [beginQuickAction, finishQuickAction, ownsQuickAction],
  );

  // Native share: share visual image via Web Share API when available.
  const nativeShare = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      const svg = rendererRef.current;
      if (!svg || !parsed.success) return;
      if (!beginQuickAction("share")) return;
      const visualData = parsed.data;
      const name = visualData.title?.trim() || "visual";
      try {
        const opts = applySocialPresetToOptions(
          "square",
          DEFAULT_EXPORT_OPTIONS,
        );
        const blob = await exportPNG(svg, opts);
        if (!ownsQuickAction("share")) return;
        if (blob) {
          const file = new File([blob], `${sanitizeFilename(name)}.png`, {
            type: "image/png",
          });
          if (canWebShare(file)) {
            await navigator.share({ files: [file], title: name });
            if (ownsQuickAction("share")) {
              setNativeShareState("idle");
              setActionStatus("Visual shared.");
            }
            return;
          }
        }
        if (canWebShare()) {
          await navigator.share({ title: name });
          if (ownsQuickAction("share")) {
            setNativeShareState("idle");
            setActionStatus("Visual shared.");
          }
          return;
        }
        throw new Error("Web Share API became unavailable");
      } catch (err) {
        if (!ownsQuickAction("share")) return;
        // User-initiated cancellation is a normal outcome, not an error.
        if (err instanceof Error && err.name === "AbortError") {
          setNativeShareState("idle");
          setActionStatus("Sharing cancelled.");
        } else {
          setNativeShareState("error");
          setActionError({
            action: "share",
            message: "Visual sharing failed. Try again.",
          });
        }
      } finally {
        finishQuickAction("share");
      }
    },
    [beginQuickAction, finishQuickAction, ownsQuickAction, parsed],
  );

  if (!parsed.success) {
    return (
      <div
        role="img"
        aria-label="Unavailable visual"
        className="my-4 rounded-2xl border border-dashed border-[var(--ds-border-subtle,rgba(0,0,0,0.12))] bg-[var(--ds-surface-sunken,#f4f4f5)] p-6 text-center text-sm text-[var(--ds-text-muted,#6f7d83)]"
      >
        This visual could not be displayed.
      </div>
    );
  }

  const data = parsed.data;
  const previewNodeBoxes = nodeBoxes(data);
  const previewEdgeSegments = edgeSegments(data);
  const previewViewBox = contentViewBox(data);

  const cardClass = [
    "overflow-hidden rounded-2xl border bg-[var(--ds-surface-base,#ffffff)] p-2 transition",
    showControls
      ? "border-[var(--ds-accent,#6366f1)] ring-2 ring-[var(--ds-accent,#6366f1)]/20"
      : "border-[var(--ds-border-subtle,rgba(0,0,0,0.06))]",
  ].join(" ");
  const quickActionVisibility =
    activeQuickAction !== null
      ? "opacity-100"
      : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

  return (
    <motion.div
      ref={rootRef}
      data-visual-chrome
      className="relative my-4"
      initial={cardMotion.initial}
      animate={cardMotion.animate}
      transition={cardMotion.transition}
    >
      {showControls ? (
        <div className={cardClass}>
          <VisualEditor
            visual={data}
            onChange={updateVisual}
            onCommand={handleCommand}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            initialSelectedNodeId={selectedNodeId}
            initialSelectedEdgeId={selectedEdgeId}
            rendererRef={rendererRef}
            canEdit
          />
        </div>
      ) : editable ? (
        <div className="group relative" aria-busy={activeQuickAction !== null}>
          <div
            role="button"
            tabIndex={0}
            aria-label="Edit visual"
            // Prevent the button from grabbing focus from the editor on click
            // (avoids a focus flash as it unmounts into the editing controls)
            // while still firing `onClick`; keyboard activation is unaffected.
            onPointerDownCapture={selectPreviewElement}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (suppressPreviewClickRef.current) {
                suppressPreviewClickRef.current = false;
                return;
              }
              selectVisual(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectVisual(null);
              }
            }}
            className={`${cardClass} block w-full cursor-pointer text-left hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))] ${FOCUS_RING}`}
          >
            <VisualRenderer
              ref={rendererRef}
              visual={data}
              className="pointer-events-none block h-auto w-full"
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox={`${previewViewBox.x} ${previewViewBox.y} ${previewViewBox.width} ${previewViewBox.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]"
              aria-hidden="true"
            >
              {data.edges.map((edge) => {
                const segment = previewEdgeSegments.get(edge.id);
                if (!segment) {
                  return null;
                }
                return (
                  <line
                    key={edge.id}
                    data-preview-edge-id={edge.id}
                    x1={segment.start.x}
                    y1={segment.start.y}
                    x2={segment.end.x}
                    y2={segment.end.y}
                    stroke="transparent"
                    strokeWidth={14}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    className="cursor-pointer"
                  />
                );
              })}
              {data.nodes.map((node) => {
                const box = previewNodeBoxes.get(node.id);
                if (!box) {
                  return null;
                }
                return (
                  <rect
                    key={node.id}
                    data-preview-node-id={node.id}
                    x={box.x - box.width / 2}
                    y={box.y - box.height / 2}
                    width={box.width}
                    height={box.height}
                    rx={10}
                    fill="transparent"
                    pointerEvents="all"
                    className="cursor-pointer"
                  />
                );
              })}
            </svg>
          </div>
          {actionError ? (
            <div
              role="alert"
              className="absolute left-3 right-3 top-3 flex items-center justify-between gap-3 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface px-3 py-2 text-xs text-ds-danger-text shadow-sm"
            >
              <span>{actionError.message}</span>
              <button
                type="button"
                aria-label="Dismiss visual action error"
                onClick={dismissActionError}
                className={`shrink-0 rounded-ds-sm px-1.5 py-0.5 font-semibold hover:bg-ds-state-hover ${FOCUS_RING}`}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <p role="status" aria-live="polite" className="sr-only">
            {activeQuickAction === "download"
              ? "Downloading visual as PNG."
              : activeQuickAction === "copy"
                ? "Copying visual image to the clipboard."
                : activeQuickAction === "share"
                  ? "Preparing visual to share."
                  : actionStatus}
          </p>
          <div
            className={[
              "tiq-coarse-actions absolute bottom-3 right-3 flex items-center gap-1 transition-opacity motion-reduce:transition-none",
              quickActionVisibility,
            ].join(" ")}
          >
            {/* Quick-download button — visible on hover, focus, and coarse pointers. */}
            <button
              type="button"
              aria-label={
                activeQuickAction === "download"
                  ? "Downloading visual as PNG"
                  : "Download visual as PNG"
              }
              onClick={quickDownload}
              disabled={activeQuickAction !== null}
              className={[
                "tiq-touch-target flex h-7 w-7 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-glass text-ds-text-muted shadow-sm backdrop-blur-sm transition hover:text-ds-text-primary disabled:cursor-wait disabled:text-ds-text-muted",
                FOCUS_RING,
              ].join(" ")}
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            {/* Copy image to clipboard — only when Clipboard API is available. */}
            {canCopyImageToClipboard() && (
              <button
                type="button"
                aria-label={
                  copyImageState === "copied"
                    ? "Image copied!"
                    : copyImageState === "error"
                      ? "Copy failed"
                      : activeQuickAction === "copy"
                        ? "Copying image to clipboard"
                        : "Copy image to clipboard"
                }
                onClick={copyImage}
                disabled={activeQuickAction !== null}
                className={[
                  "tiq-touch-target flex h-7 w-7 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-glass text-ds-text-muted shadow-sm backdrop-blur-sm transition hover:text-ds-text-primary disabled:cursor-wait disabled:text-ds-text-muted",
                  FOCUS_RING,
                ].join(" ")}
              >
                {copyImageState === "copied" ? (
                  <Check
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-ds-success-text"
                  />
                ) : (
                  <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {/* Native share — only on devices that support Web Share API. */}
            {canWebShare() && (
              <button
                type="button"
                aria-label={
                  nativeShareState === "error"
                    ? "Share failed"
                    : activeQuickAction === "share"
                      ? "Sharing visual"
                      : "Share visual"
                }
                onClick={nativeShare}
                disabled={activeQuickAction !== null}
                className={[
                  "tiq-touch-target flex h-7 w-7 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-glass text-ds-text-muted shadow-sm backdrop-blur-sm transition hover:text-ds-text-primary disabled:cursor-wait disabled:text-ds-text-muted",
                  FOCUS_RING,
                ].join(" ")}
              >
                <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={cardClass}>
          <VisualRenderer
            ref={rendererRef}
            visual={data}
            className="block h-auto w-full"
          />
        </div>
      )}

      {/* Float the visual editing popover inline beside the selected visual so
          its properties can be adjusted in place. Suppressed while the
          SlideEditor panel is open so large editor overlays do not compete. */}
      {showControls &&
      !suppressFloatPopover &&
      selectedEdgeId === null &&
      editingSurface.mode === "float" ? (
        <VisualContextPopover
          visualId={visualId}
          visual={data}
          selectedNodeId={selectedNodeId}
          onChange={updateVisual}
          onCommand={handleCommand}
          onRemove={removeVisual}
          onRemoveSelectedNode={selectedNodeId ? removeSelectedNode : undefined}
          onClose={closeControls}
          getSvgElement={() => rendererRef.current}
          anchorRef={rootRef}
          currentSourceText={currentSourceText}
          onApplyBrandToAll={applyBrandToAll}
          onDuplicate={duplicateVisual}
        />
      ) : null}
    </motion.div>
  );
}
