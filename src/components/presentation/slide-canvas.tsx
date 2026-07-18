"use client";

/**
 * presentation slide canvas — renders a `ResolvedSlideRenderTree` or a single slide
 * from a `ResolvedDeckRenderTree` without any v6 materialization.
 *
 * Rendering order (spec §Render Tree):
 *   1. Slide background fill.
 *   2. Theme decoration nodes (behind user nodes) — not selectable in normal mode.
 *   3. Background deck chrome such as watermarks.
 *   4. User nodes in deck traversal order, with later nodes in the foreground.
 *   5. Foreground deck chrome such as logo/footer/page number/border.
 *
 * The canvas is `position: relative` with an aspect ratio driven by the
 * `canvas` spec.  All children are positioned absolutely in canvas-percent
 * space so the layout is resolution-independent.
 */

import { memo, useId, type JSX } from "react";

import type {
  ResolvedSlideRenderTree,
  ResolvedDeckRenderTree,
  ResolvedRenderNode,
} from "@/lib/presentation/render-tree";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { getSlideRenderLists } from "@/lib/presentation/render-tree";
import { buildDeckOutline, type DeckOutline } from "@/lib/presentation";
import type { CanvasSpec } from "@/lib/presentation/types";
import type {
  ConnectorEndpoint,
  ImageCrop,
  LayoutBox,
} from "@/lib/presentation/schema";
import type { Visual } from "@/lib/visual/schema";

import { fillStyleToCss } from "./fill-style-css";
import { SlideNodeRenderer } from "./slide-node-renderer";
import { SlideCanvasInteractionOverlay } from "./slide-canvas-overlays";
import {
  focusGeometryTargets,
  type FocusGeometryRegistry,
} from "./focus-geometry-registry";
import type {
  ConnectorEndpointHandle,
  CropHandlePosition,
  ResizeHandlePosition,
} from "./slide-canvas-overlays";
import type { SelectionState } from "./selection-model";
import { isSelected } from "./selection-model";

const DECK_OUTLINE_FOCUS_VISIBLE_CHROME = cx(
  "rounded-ds-sm motion-reduce:transition-none",
  FOCUS_RING,
);

export type {
  ConnectorEndpointHandle,
  CropHandlePosition,
  ResizeHandlePosition,
} from "./slide-canvas-overlays";

export interface SlideCanvasNodeGestureDraft {
  frame?: LayoutBox["frame"];
  rotation?: number;
  crop?: ImageCrop;
  connectorEndpoints?: Partial<
    Record<ConnectorEndpointHandle, ConnectorEndpoint>
  >;
}

// ---------------------------------------------------------------------------
// Canvas aspect ratio
// ---------------------------------------------------------------------------

function canvasAspectRatio(canvas: CanvasSpec): number {
  if (canvas.height > 0 && canvas.width > 0) {
    return canvas.width / canvas.height;
  }
  return 16 / 9;
}

// ---------------------------------------------------------------------------
// SlideCanvas — single slide
// ---------------------------------------------------------------------------

export interface SlideCanvasProps {
  /** The resolved render tree for the slide to display. */
  slide: ResolvedSlideRenderTree;
  /** Canvas spec for aspect ratio.  Defaults to 16:9 when omitted. */
  canvas?: CanvasSpec;
  /**
   * Resolves an asset id to its src URL.  Used for images, visuals, and
   * image-fill backgrounds.  Safe to omit when no media nodes are present.
   */
  assetResolver?: (id: string) => string | undefined;
  /** Resolves a document visual id to its live visual payload. */
  visualResolver?: (id: string) => Visual | undefined;
  /**
   * Current selection state. When provided, selected nodes display a focus
   * ring; pointer-down on nodes starts selection/drag handling.
   */
  selection?: SelectionState;
  /** Called when the user double-clicks a node (used to enter inline edit mode). */
  onNodeDoubleClick?: (nodeId: string, event: React.MouseEvent) => void;
  /** Called when the user starts dragging a node. */
  onNodePointerDown?: (nodeId: string, event: React.PointerEvent) => void;
  /** Called when a node receives keyboard focus. */
  onNodeFocus?: (nodeId: string, event: React.FocusEvent) => void;
  /** Called when the user starts resizing a selected node. */
  onResizeHandlePointerDown?: (
    nodeId: string,
    handle: ResizeHandlePosition,
    event: React.PointerEvent,
  ) => void;
  onMultiResizeHandlePointerDown?: (
    handle: ResizeHandlePosition,
    event: React.PointerEvent,
  ) => void;
  onMultiRotationHandlePointerDown?: (event: React.PointerEvent) => void;
  /** Called when the user starts cropping a selected image. */
  onCropHandlePointerDown?: (
    nodeId: string,
    handle: CropHandlePosition,
    event: React.PointerEvent,
  ) => void;
  /** Called when the user starts rotating a selected node. */
  onRotationHandlePointerDown?: (
    nodeId: string,
    event: React.PointerEvent,
  ) => void;
  /** Called when the user drags a connector endpoint. */
  onConnectorEndpointPointerDown?: (
    nodeId: string,
    endpoint: ConnectorEndpointHandle,
    event: React.PointerEvent,
  ) => void;
  /** Currently active resize handle, if any. */
  activeResizeHandle?: { nodeId: string; handle: ResizeHandlePosition } | null;
  /** Currently active crop handle, if any. */
  activeCropHandle?: { nodeId: string; handle: CropHandlePosition } | null;
  /** Currently active rotation handle, if any. */
  activeRotationNodeId?: string | null;
  /** Currently active connector endpoint, if any. */
  activeConnectorEndpoint?: {
    nodeId: string;
    endpoint: ConnectorEndpointHandle;
  } | null;
  /** Transient, gesture-local node patches rendered before commit. */
  nodeGestureDrafts?: ReadonlyMap<string, SlideCanvasNodeGestureDraft>;
  /** Active group context id for group-member direct editing. */
  activeGroupId?: string | null;
  /** Active table direct-edit context. */
  tableEditingNodeId?: string | null;
  activeTableCell?: { rowIndex: number; colIndex: number } | null;
  onTableCellFocus?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onTableCellCommit?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
    text: string,
  ) => void;
  onTableCellKeyDown?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;
  /**
   * Node ids to hide from the canvas (e.g., the node being inline-edited
   * is hidden while the overlay editor is active).
   */
  hiddenNodeIds?: ReadonlySet<string>;
  /** Node currently hovered by the pointer. */
  hoveredNodeId?: string | null;
  /** True when the slide background is the current hover/preselection target. */
  slideHovered?: boolean;
  /** True when the slide itself is selected (no node selection). */
  slideSelected?: boolean;
  /** Roving-tabindex focus target. */
  focusedNodeId?: string | null;
  /** Optional registry used by the editor to focus/measure stage nodes. */
  focusGeometryRegistry?: FocusGeometryRegistry;
  /** True when rendered at reduced size (thumbnail rail, next-slide preview). */
  preview?: boolean;
  /** True while the stage is actively dragging nodes. */
  draggingStage?: boolean;
  /** Optional extra CSS class applied to the outer canvas container. */
  className?: string;
  /** Optional accessible deck/slide outline rendered near the stage. */
  deckOutline?: DeckOutline;
  /** Active slide index for the accessible outline. */
  outlineActiveSlideIndex?: number;
  /** Current node id for the accessible outline. */
  outlineCurrentNodeId?: string | null;
}

/**
 * Renders a single resolved slide as a percentage-positioned canvas.
 *
 * Decorations are rendered first (behind) and are never selectable unless the
 * selection is in "layers" mode.
 *
 * Wrapped with `React.memo` so unchanged slides skip re-render when a sibling
 * slide is mutated.
 */
export const SlideCanvas = memo(function SlideCanvas({
  slide,
  canvas,
  assetResolver,
  visualResolver,
  selection,
  onNodeDoubleClick,
  onNodePointerDown,
  onNodeFocus,
  onResizeHandlePointerDown,
  onMultiResizeHandlePointerDown,
  onMultiRotationHandlePointerDown,
  onCropHandlePointerDown,
  onRotationHandlePointerDown,
  onConnectorEndpointPointerDown,
  activeResizeHandle,
  activeCropHandle,
  activeRotationNodeId,
  activeConnectorEndpoint,
  nodeGestureDrafts,
  activeGroupId,
  tableEditingNodeId,
  activeTableCell,
  onTableCellFocus,
  onTableCellCommit,
  onTableCellKeyDown,
  hiddenNodeIds,
  hoveredNodeId,
  slideHovered = false,
  slideSelected = false,
  focusedNodeId,
  focusGeometryRegistry,
  preview = false,
  draggingStage = false,
  className,
  deckOutline,
  outlineActiveSlideIndex = 0,
  outlineCurrentNodeId,
}: SlideCanvasProps): JSX.Element {
  const aspectRatio = canvas ? canvasAspectRatio(canvas) : 16 / 9;
  const backgroundFill = slide.background.fill;
  const backgroundFillStyle = fillStyleToCss(backgroundFill, assetResolver);
  const backgroundFillLayerStyle =
    backgroundFill?.type === "image" &&
    backgroundFillStyle.backgroundImage !== undefined
      ? {
          ...backgroundFillStyle,
          position: "absolute" as const,
          inset: 0,
          pointerEvents: "none" as const,
          ...(backgroundFill.opacity !== undefined
            ? { opacity: backgroundFill.opacity }
            : {}),
        }
      : undefined;

  const renderLists = getSlideRenderLists(slide);
  const decorationNodes = renderLists.decorations;
  const backgroundChromeNodes = renderLists.backgroundChrome;
  const foregroundChromeNodes = renderLists.foregroundChrome;
  const userNodes =
    nodeGestureDrafts && nodeGestureDrafts.size > 0
      ? renderLists.userNodes.map((node) =>
          applyNodeGestureDraft(node, nodeGestureDrafts),
        )
      : renderLists.userNodes;
  const isHiddenNode = (nodeId: string) => hiddenNodeIds?.has(nodeId) === true;

  const handleNodeDoubleClick = onNodeDoubleClick
    ? (nodeId: string, event: React.MouseEvent) => {
        onNodeDoubleClick(nodeId, event);
      }
    : undefined;
  const stageNodeRef =
    focusGeometryRegistry && !preview
      ? (nodeId: string) => (element: HTMLDivElement | null) => {
          focusGeometryRegistry.register(
            focusGeometryTargets.stageNode(nodeId),
            element,
          );
        }
      : undefined;

  const canvasElement = (
    <div
      data-slide-canvas="true"
      data-slide-hovered={slideHovered ? "true" : undefined}
      data-slide-selected={slideSelected ? "true" : undefined}
      className={`relative overflow-hidden${className ? ` ${className}` : ""}`}
      style={{
        aspectRatio: `${aspectRatio}`,
        width: "100%",
        cursor: draggingStage ? "grabbing" : undefined,
        ...(backgroundFillLayerStyle ? {} : backgroundFillStyle),
      }}
    >
      {backgroundFillLayerStyle ? (
        <div
          aria-hidden="true"
          data-slide-background-fill-layer="image"
          style={backgroundFillLayerStyle}
        />
      ) : null}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
        }}
      >
        {/* Decorations — rendered behind user nodes, aria-hidden */}
        {decorationNodes.map((node) => (
          <SlideNodeRenderer
            key={node.id}
            node={node}
            nodeRef={stageNodeRef?.(node.id)}
            assetResolver={assetResolver}
            visualResolver={visualResolver}
            preview={preview}
            hidden={isHiddenNode(node.id)}
            // Decorations are never interactive in the normal canvas
          />
        ))}

        {/* Background deck chrome — non-interactive outside layers mode */}
        {backgroundChromeNodes.map((node) => (
          <SlideNodeRenderer
            key={node.id}
            node={node}
            nodeRef={stageNodeRef?.(node.id)}
            assetResolver={assetResolver}
            visualResolver={visualResolver}
            preview={preview}
            hidden={isHiddenNode(node.id)}
          />
        ))}

        {/* User nodes */}
        {userNodes.map((node) =>
          (() => {
            const selected = selection ? isSelected(selection, node.id) : false;
            const interactive = !preview && onNodePointerDown !== undefined;
            return (
              <SlideNodeRenderer
                key={node.id}
                node={node}
                nodeRef={stageNodeRef?.(node.id)}
                selected={selected}
                hovered={hoveredNodeId === node.id}
                focused={focusedNodeId === node.id}
                interactive={interactive}
                tabIndex={
                  interactive
                    ? focusedNodeId === node.id ||
                      (focusedNodeId === undefined && selected)
                      ? 0
                      : -1
                    : undefined
                }
                onDoubleClick={handleNodeDoubleClick}
                onPointerDown={preview ? undefined : onNodePointerDown}
                onFocus={preview ? undefined : onNodeFocus}
                tableEditing={tableEditingNodeId === node.id}
                activeTableCell={
                  tableEditingNodeId === node.id ? activeTableCell : null
                }
                onTableCellFocus={onTableCellFocus}
                onTableCellCommit={onTableCellCommit}
                onTableCellKeyDown={onTableCellKeyDown}
                assetResolver={assetResolver}
                visualResolver={visualResolver}
                preview={preview}
                hidden={isHiddenNode(node.id)}
                dragging={draggingStage}
              />
            );
          })(),
        )}

        {/* Foreground deck chrome — rendered above user nodes and aria-hidden */}
        {foregroundChromeNodes.map((node) => (
          <SlideNodeRenderer
            key={node.id}
            node={node}
            nodeRef={stageNodeRef?.(node.id)}
            assetResolver={assetResolver}
            visualResolver={visualResolver}
            preview={preview}
            hidden={isHiddenNode(node.id)}
          />
        ))}

        {!preview ? (
          <SlideCanvasInteractionOverlay
            nodes={userNodes}
            selection={selection}
            hiddenNodeIds={hiddenNodeIds}
            hoveredNodeId={hoveredNodeId}
            focusedNodeId={focusedNodeId}
            slideHovered={slideHovered}
            slideSelected={slideSelected}
            activeGroupId={activeGroupId}
            onNodePointerDown={onNodePointerDown}
            onMultiResizeHandlePointerDown={onMultiResizeHandlePointerDown}
            onMultiRotationHandlePointerDown={onMultiRotationHandlePointerDown}
            onResizeHandlePointerDown={onResizeHandlePointerDown}
            onCropHandlePointerDown={onCropHandlePointerDown}
            onRotationHandlePointerDown={onRotationHandlePointerDown}
            onConnectorEndpointPointerDown={onConnectorEndpointPointerDown}
            activeResizeHandle={activeResizeHandle}
            activeCropHandle={activeCropHandle}
            activeRotationNodeId={activeRotationNodeId}
            activeConnectorEndpoint={activeConnectorEndpoint}
          />
        ) : null}
      </div>
    </div>
  );
  if (preview || !deckOutline) return canvasElement;
  return (
    <>
      <DeckOutlineRegion
        outline={deckOutline}
        activeSlideIndex={outlineActiveSlideIndex}
        currentNodeId={outlineCurrentNodeId}
      />
      {canvasElement}
    </>
  );
});

function applyNodeGestureDraft(
  node: ResolvedRenderNode,
  nodeGestureDrafts:
    | ReadonlyMap<string, SlideCanvasNodeGestureDraft>
    | undefined,
): ResolvedRenderNode {
  const draft = nodeGestureDrafts?.get(node.id);
  if (!draft) return node;
  let nextNode = node;
  if (draft.frame || draft.rotation !== undefined) {
    nextNode = {
      ...nextNode,
      layout: {
        ...nextNode.layout,
        ...(draft.frame ? { frame: draft.frame } : {}),
        ...(draft.rotation !== undefined ? { rotation: draft.rotation } : {}),
      },
    };
  }
  if (draft.crop && nextNode.content.type === "image") {
    nextNode = {
      ...nextNode,
      content: {
        ...nextNode.content,
        content: {
          ...nextNode.content.content,
          crop: draft.crop,
        },
      },
    };
  }
  if (
    draft.connectorEndpoints &&
    (draft.connectorEndpoints.from || draft.connectorEndpoints.to) &&
    nextNode.content.type === "connector"
  ) {
    nextNode = {
      ...nextNode,
      content: {
        ...nextNode.content,
        content: {
          ...nextNode.content.content,
          ...(draft.connectorEndpoints.from
            ? { from: draft.connectorEndpoints.from }
            : {}),
          ...(draft.connectorEndpoints.to
            ? { to: draft.connectorEndpoints.to }
            : {}),
        },
      },
    };
  }
  return nextNode;
}

// ---------------------------------------------------------------------------
// DeckCanvas — renders all slides in a deck tree
// ---------------------------------------------------------------------------

export interface DeckCanvasProps {
  /** The fully resolved deck render tree. */
  deck: ResolvedDeckRenderTree;
  /** Index of the currently active slide. Defaults to 0. */
  activeSlideIndex?: number;
  /** Same semantics as `SlideCanvasProps.assetResolver`. */
  assetResolver?: (id: string) => string | undefined;
  /** Same semantics as `SlideCanvasProps.visualResolver`. */
  visualResolver?: (id: string) => Visual | undefined;
  /** Same semantics as `SlideCanvasProps.selection`. */
  selection?: SelectionState;
  /** Called when the user starts dragging a node on the active slide. */
  onNodePointerDown?: (nodeId: string, event: React.PointerEvent) => void;
  /** Called when the user starts resizing a selected node on the active slide. */
  onResizeHandlePointerDown?: SlideCanvasProps["onResizeHandlePointerDown"];
  onMultiResizeHandlePointerDown?: SlideCanvasProps["onMultiResizeHandlePointerDown"];
  onMultiRotationHandlePointerDown?: SlideCanvasProps["onMultiRotationHandlePointerDown"];
  /** Called when the user clicks a slide in the thumbnail rail. */
  onSlideClick?: (slideIndex: number) => void;
  /** True when rendered at reduced size. */
  preview?: boolean;
  /** Extra CSS class for the outer wrapper. */
  className?: string;
}

export interface DeckOutlineRegionProps {
  outline: DeckOutline;
  activeSlideIndex?: number;
  currentNodeId?: string | null;
}

export function DeckOutlineRegion({
  outline,
  activeSlideIndex = 0,
  currentNodeId,
}: DeckOutlineRegionProps): JSX.Element | null {
  const headingId = useId();
  if (outline.slides.length === 0) return null;
  const activeSlide = outline.slides[activeSlideIndex] ?? outline.slides[0];

  return (
    <section
      data-deck-outline-region="true"
      role="region"
      aria-labelledby={headingId}
      className={cx(
        "sr-only motion-reduce:transition-none",
        "focus-within:not-sr-only focus-within:absolute focus-within:left-2 focus-within:top-2 focus-within:z-overlay focus-within:max-h-80 focus-within:w-80 focus-within:overflow-auto focus-within:rounded-ds-md focus-within:border focus-within:border-ds-border-subtle focus-within:bg-ds-surface-raised focus-within:p-3 focus-within:text-ds-text-primary focus-within:shadow-ds-overlay",
      )}
    >
      <h2 id={headingId}>Deck outline</h2>
      <p>
        {outline.slides.length} slide{outline.slides.length === 1 ? "" : "s"}.
        Current slide {activeSlide.position}: {activeSlide.title}.{" "}
        {activeSlide.summary}.
      </p>
      <ol aria-label="Slides">
        {outline.slides.map((slide) => (
          <li
            key={slide.id}
            aria-current={
              slide.index === activeSlide.index ? "page" : undefined
            }
          >
            <article aria-label={`Slide ${slide.position}: ${slide.title}`}>
              <h3>
                Slide {slide.position} of {outline.slides.length}: {slide.title}
              </h3>
              <p>{slide.summary}</p>
              <ol aria-label={`Slide ${slide.position} nodes`}>
                {slide.nodes.map((node) => (
                  <li
                    key={node.id}
                    tabIndex={0}
                    className={DECK_OUTLINE_FOCUS_VISIBLE_CHROME}
                    aria-current={
                      node.id === currentNodeId ? "true" : undefined
                    }
                    aria-label={`${node.role}: ${node.label}`}
                  >
                    <span>{node.role}</span>: <span>{node.label}</span>
                  </li>
                ))}
              </ol>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Renders the active slide from a `ResolvedDeckRenderTree`.
 *
 * This component is intentionally minimal: it selects the active slide and
 * delegates to `SlideCanvas`, which renders the resolved theme decoration,
 * user-node, and deck chrome layers.
 */
export function DeckCanvas({
  deck,
  activeSlideIndex = 0,
  assetResolver,
  visualResolver,
  selection,
  onNodePointerDown,
  onResizeHandlePointerDown,
  onMultiResizeHandlePointerDown,
  onMultiRotationHandlePointerDown,
  preview = false,
  className,
}: DeckCanvasProps): JSX.Element | null {
  const slide = deck.slides[activeSlideIndex];
  if (!slide) return null;
  const currentNodeId = selection?.nodeIds.values().next().value ?? null;

  return (
    <SlideCanvas
      slide={slide}
      canvas={deck.canvas}
      assetResolver={assetResolver}
      visualResolver={visualResolver}
      selection={selection}
      onNodePointerDown={onNodePointerDown}
      onResizeHandlePointerDown={onResizeHandlePointerDown}
      onMultiResizeHandlePointerDown={onMultiResizeHandlePointerDown}
      onMultiRotationHandlePointerDown={onMultiRotationHandlePointerDown}
      preview={preview}
      className={className}
      deckOutline={preview ? undefined : buildDeckOutline(deck)}
      outlineActiveSlideIndex={activeSlideIndex}
      outlineCurrentNodeId={currentNodeId}
    />
  );
}
