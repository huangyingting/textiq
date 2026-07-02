"use client";

import type { CSSProperties, JSX, PointerEvent } from "react";

import type { ResolvedRenderNode } from "@/lib/presentation-vnext/render-tree";
import {
  STAGE_CHROME_Z_INDEX,
  selectionFrameChrome,
} from "@/lib/presentation-vnext/stage-chrome";

import type { SelectionState } from "./selection-model";
import { isSelected } from "./selection-model";
import { frameToCss, nodeLayoutTransformToCss } from "./slide-node-renderer";

export type ResizeHandlePosition =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export type CropHandlePosition = "top" | "right" | "bottom" | "left";

export type ConnectorEndpointHandle = "from" | "to";

const RESIZE_HANDLES: readonly ResizeHandlePosition[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
const CROP_HANDLES: readonly CropHandlePosition[] = [
  "top",
  "right",
  "bottom",
  "left",
];
const RESIZE_HANDLE_CURSORS: Record<ResizeHandlePosition, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};
const CROP_HANDLE_CURSORS: Record<CropHandlePosition, string> = {
  top: "ns-resize",
  right: "ew-resize",
  bottom: "ns-resize",
  left: "ew-resize",
};

export interface SlideCanvasInteractionOverlayProps {
  nodes: readonly ResolvedRenderNode[];
  selection?: SelectionState;
  hiddenNodeIds?: ReadonlySet<string>;
  hoveredNodeId?: string | null;
  focusedNodeId?: string | null;
  slideHovered?: boolean;
  slideSelected?: boolean;
  activeGroupId?: string | null;
  onNodePointerDown?: (nodeId: string, event: PointerEvent) => void;
  onMultiResizeHandlePointerDown?: (
    handle: ResizeHandlePosition,
    event: PointerEvent,
  ) => void;
  onMultiRotationHandlePointerDown?: (event: PointerEvent) => void;
  onResizeHandlePointerDown?: (
    nodeId: string,
    handle: ResizeHandlePosition,
    event: PointerEvent,
  ) => void;
  onCropHandlePointerDown?: (
    nodeId: string,
    handle: CropHandlePosition,
    event: PointerEvent,
  ) => void;
  onRotationHandlePointerDown?: (nodeId: string, event: PointerEvent) => void;
  onConnectorEndpointPointerDown?: (
    nodeId: string,
    endpoint: ConnectorEndpointHandle,
    event: PointerEvent,
  ) => void;
  activeResizeHandle?: { nodeId: string; handle: ResizeHandlePosition } | null;
  activeCropHandle?: { nodeId: string; handle: CropHandlePosition } | null;
  activeRotationNodeId?: string | null;
  activeConnectorEndpoint?: {
    nodeId: string;
    endpoint: ConnectorEndpointHandle;
  } | null;
}

export function SlideCanvasInteractionOverlay({
  nodes,
  selection,
  hiddenNodeIds,
  hoveredNodeId,
  focusedNodeId,
  slideHovered = false,
  slideSelected = false,
  activeGroupId,
  onNodePointerDown,
  onMultiResizeHandlePointerDown,
  onMultiRotationHandlePointerDown,
  onResizeHandlePointerDown,
  onCropHandlePointerDown,
  onRotationHandlePointerDown,
  onConnectorEndpointPointerDown,
  activeResizeHandle,
  activeCropHandle,
  activeRotationNodeId,
  activeConnectorEndpoint,
}: SlideCanvasInteractionOverlayProps): JSX.Element | null {
  const isHiddenNode = (nodeId: string) => hiddenNodeIds?.has(nodeId) === true;
  const selectedUserNodes = selection
    ? nodes.filter((node) => isSelected(selection, node.id))
    : [];
  const isMultiSelect = selectedUserNodes.length > 1;
  const selectedResizableNodes = selectedUserNodes.filter(
    (node) => node.locked !== true,
  );
  const singleSelectedResizableNodes = isMultiSelect
    ? []
    : selectedResizableNodes;
  const selectedCroppableNodes = singleSelectedResizableNodes.filter(
    (node) => node.type === "image" && node.content.type === "image",
  );
  const selectedRotatableNodes = singleSelectedResizableNodes.filter(
    (node) => node.type !== "connector",
  );
  const selectedConnectorNodes = singleSelectedResizableNodes.filter(
    (node) => node.type === "connector" && node.content.type === "connector",
  );
  const activeGroupNode = activeGroupId
    ? nodes.find((node) => node.id === activeGroupId && node.type === "group")
    : undefined;
  const preselectedUserNodes = nodes.filter(
    (node) =>
      !isHiddenNode(node.id) &&
      !selectedUserNodes.some((selectedNode) => selectedNode.id === node.id) &&
      (hoveredNodeId === node.id || focusedNodeId === node.id),
  );
  const selectedMoveHandleNodes = selectedResizableNodes.filter((node) =>
    isHiddenNode(node.id),
  );
  const multiSelectionFrame =
    selectedUserNodes.length > 1 ? boundsForNodes(selectedUserNodes) : null;

  const hasOverlayContent =
    (slideHovered && !slideSelected) ||
    slideSelected ||
    preselectedUserNodes.length > 0 ||
    selectedUserNodes.length > 0 ||
    activeGroupNode !== undefined ||
    multiSelectionFrame !== null ||
    (onResizeHandlePointerDown !== undefined &&
      selectedResizableNodes.length > 0) ||
    (onRotationHandlePointerDown !== undefined &&
      selectedRotatableNodes.length > 0) ||
    (onCropHandlePointerDown !== undefined &&
      selectedCroppableNodes.length > 0) ||
    (onConnectorEndpointPointerDown !== undefined &&
      selectedConnectorNodes.length > 0);

  if (!hasOverlayContent) return null;

  return (
    <>
      {slideHovered && !slideSelected ? (
        <SlideChromeFrame variant="preselected" />
      ) : null}

      {slideSelected ? <SlideChromeFrame variant="selected" /> : null}

      {preselectedUserNodes.map((node) => (
        <NodeChromeFrame
          key={`${node.id}-preselected-frame`}
          node={node}
          variant="preselected"
        />
      ))}

      {selectedUserNodes.map((node) => (
        <NodeChromeFrame
          key={`${node.id}-selected-frame`}
          node={node}
          variant="selected"
          elevated={isHiddenNode(node.id)}
        />
      ))}

      {onNodePointerDown
        ? selectedMoveHandleNodes.map((node) => (
            <NodeMoveHandles
              key={`${node.id}-move-handles`}
              node={node}
              onPointerDown={onNodePointerDown}
            />
          ))
        : null}

      {activeGroupNode ? (
        <NodeChromeFrame node={activeGroupNode} variant="activeGroup" />
      ) : null}

      {multiSelectionFrame ? (
        <div
          aria-hidden="true"
          data-multi-selection-bounds="true"
          data-node-id={selectedUserNodes.map((node) => node.id).join(" ")}
          className="pointer-events-auto absolute border-2 border-dashed border-ds-accent-fill bg-ds-accent-surface/15 shadow-[0_0_0_1px_var(--ds-accent-border)]"
          style={{
            left: `${multiSelectionFrame.x}%`,
            top: `${multiSelectionFrame.y}%`,
            width: `${multiSelectionFrame.w}%`,
            height: `${multiSelectionFrame.h}%`,
            zIndex: STAGE_CHROME_Z_INDEX.multiSelectionBounds,
            cursor: "default",
          }}
          onPointerDown={(event) => {
            if (!onNodePointerDown) return;
            const firstNodeId = selectedUserNodes[0]?.id;
            if (!firstNodeId) return;
            event.stopPropagation();
            onNodePointerDown(firstNodeId, event);
          }}
        >
          {onMultiResizeHandlePointerDown
            ? RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  data-multi-resize-handle={handle}
                  className="pointer-events-auto absolute h-2.5 w-2.5 rounded-full border border-ds-accent-border bg-ds-surface shadow-ds-sm"
                  style={{
                    ...resizeHandleStyle(handle),
                    cursor: RESIZE_HANDLE_CURSORS[handle],
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onMultiResizeHandlePointerDown(handle, event);
                  }}
                />
              ))
            : null}
          {onMultiRotationHandlePointerDown ? (
            <span
              data-multi-rotation-handle="true"
              className="pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border border-ds-accent-border bg-ds-surface text-[10px] leading-none text-ds-text-secondary shadow-ds-sm"
              style={{
                left: "50%",
                top: "calc(100% + 28px)",
                transform: "translate(-50%, -50%)",
                cursor: "grab",
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onMultiRotationHandlePointerDown(event);
              }}
            >
              ↻
            </span>
          ) : null}
        </div>
      ) : null}

      {onResizeHandlePointerDown
        ? singleSelectedResizableNodes.map((node) => (
            <div
              key={`${node.id}-resize-overlay`}
              aria-hidden="true"
              data-node-chrome-overlay="resize"
              data-node-id={node.id}
              className="pointer-events-none absolute"
              style={nodeChromeOverlayFrameStyle(
                node,
                chromeZIndexForNode(
                  isHiddenNode(node.id),
                  STAGE_CHROME_Z_INDEX.selectedFrame,
                ),
              )}
            >
              {RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  data-resize-handle={handle}
                  className={`pointer-events-auto absolute h-2.5 w-2.5 rounded-full border shadow-ds-sm ${
                    activeResizeHandle?.nodeId === node.id &&
                    activeResizeHandle?.handle === handle
                      ? "border-ds-accent-fill bg-ds-accent-fill"
                      : "border-ds-accent-border bg-ds-surface"
                  }`}
                  style={{
                    ...resizeHandleStyle(handle),
                    cursor: RESIZE_HANDLE_CURSORS[handle],
                  }}
                  onPointerDown={(event) =>
                    onResizeHandlePointerDown(node.id, handle, event)
                  }
                />
              ))}
            </div>
          ))
        : null}

      {onRotationHandlePointerDown
        ? selectedRotatableNodes.map((node) => (
            <div
              key={`${node.id}-rotation-overlay`}
              aria-hidden="true"
              data-node-chrome-overlay="rotation"
              data-node-id={node.id}
              className="pointer-events-none absolute"
              style={nodeChromeOverlayFrameStyle(
                node,
                chromeZIndexForNode(
                  isHiddenNode(node.id),
                  STAGE_CHROME_Z_INDEX.selectedFrame + 1,
                ),
              )}
            >
              <span
                data-rotation-handle="true"
                className={`pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border bg-ds-surface text-[10px] leading-none shadow-ds-sm ${
                  activeRotationNodeId === node.id
                    ? "border-ds-accent-fill text-ds-accent-text"
                    : "border-ds-accent-border text-ds-text-secondary"
                }`}
                style={{
                  left: "50%",
                  top: "calc(100% + 28px)",
                  transform: "translate(-50%, -50%)",
                  cursor: "grab",
                }}
                onPointerDown={(event) =>
                  onRotationHandlePointerDown(node.id, event)
                }
              >
                ↻
              </span>
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-full h-7 w-px -translate-x-1/2 bg-ds-accent-border"
              />
            </div>
          ))
        : null}

      {onCropHandlePointerDown
        ? selectedCroppableNodes.map((node) => (
            <div
              key={`${node.id}-crop-overlay`}
              aria-hidden="true"
              data-node-chrome-overlay="crop"
              data-node-id={node.id}
              className="pointer-events-none absolute"
              style={nodeChromeOverlayFrameStyle(
                node,
                chromeZIndexForNode(
                  isHiddenNode(node.id),
                  STAGE_CHROME_Z_INDEX.cropHandle,
                ),
              )}
            >
              {CROP_HANDLES.map((handle) => (
                <span
                  key={handle}
                  data-crop-handle={handle}
                  className={`pointer-events-auto absolute rounded-full border shadow-ds-sm ${
                    activeCropHandle?.nodeId === node.id &&
                    activeCropHandle?.handle === handle
                      ? "border-ds-accent-fill bg-ds-accent-fill"
                      : "border-ds-accent-border bg-ds-surface"
                  }`}
                  style={{
                    ...cropHandleStyle(handle),
                    cursor: CROP_HANDLE_CURSORS[handle],
                  }}
                  onPointerDown={(event) =>
                    onCropHandlePointerDown(node.id, handle, event)
                  }
                />
              ))}
            </div>
          ))
        : null}

      {onConnectorEndpointPointerDown
        ? selectedConnectorNodes.map((node) => {
            if (node.content.type !== "connector") return null;
            const start = connectorEndpointPoint(node.content.content.from);
            const end = connectorEndpointPoint(node.content.content.to);
            return (
              <div
                key={`${node.id}-connector-endpoints`}
                aria-hidden="true"
                data-node-chrome-overlay="connector-endpoints"
                data-node-id={node.id}
                className="pointer-events-none absolute"
                style={nodeChromeOverlayFrameStyle(
                  node,
                  chromeZIndexForNode(
                    isHiddenNode(node.id),
                    STAGE_CHROME_Z_INDEX.selectedFrame + 2,
                  ),
                )}
              >
                {(
                  [
                    ["from", start],
                    ["to", end],
                  ] as const
                ).map(([endpoint, point]) => (
                  <span
                    key={endpoint}
                    data-connector-endpoint={endpoint}
                    className={`pointer-events-auto absolute h-3 w-3 rounded-full border shadow-ds-sm ${
                      activeConnectorEndpoint?.nodeId === node.id &&
                      activeConnectorEndpoint?.endpoint === endpoint
                        ? "border-ds-accent-fill bg-ds-accent-fill"
                        : "border-ds-accent-border bg-ds-surface"
                    }`}
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                      transform: "translate(-50%, -50%)",
                      cursor: "crosshair",
                    }}
                    onPointerDown={(event) =>
                      onConnectorEndpointPointerDown(node.id, endpoint, event)
                    }
                  />
                ))}
              </div>
            );
          })
        : null}
    </>
  );
}

function NodeChromeFrame({
  node,
  variant,
  elevated = false,
}: {
  node: ResolvedRenderNode;
  variant: "selected" | "preselected" | "activeGroup";
  elevated?: boolean;
}) {
  const chrome = selectionFrameChrome(variant);
  const isLocked = node.locked === true;
  const color =
    variant === "activeGroup"
      ? "var(--ds-warning-border, #f59e0b)"
      : "var(--ds-accent-fill, #6366f1)";
  return (
    <div
      aria-hidden="true"
      data-node-chrome-frame={variant}
      data-node-id={node.id}
      className="pointer-events-none absolute box-border"
      style={{
        ...nodeChromeOverlayFrameStyle(
          node,
          elevated
            ? Math.max(chrome.zIndex, STAGE_CHROME_Z_INDEX.inlineEditor + 1)
            : chrome.zIndex,
        ),
        border: `${chrome.borderWidthPx}px ${isLocked ? "dashed" : "solid"} ${color}`,
        opacity: chrome.opacity,
      }}
    />
  );
}

function NodeMoveHandles({
  node,
  onPointerDown,
}: {
  node: ResolvedRenderNode;
  onPointerDown: (nodeId: string, event: PointerEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      data-node-chrome-overlay="move"
      data-node-id={node.id}
      className="pointer-events-none absolute"
      style={nodeChromeOverlayFrameStyle(
        node,
        STAGE_CHROME_Z_INDEX.inlineEditor + 2,
      )}
    >
      {(["top", "right", "bottom", "left"] as const).map((edge) => (
        <span
          key={edge}
          data-node-move-handle={edge}
          data-node-id={node.id}
          className="pointer-events-auto absolute"
          style={{ ...moveHandleStyle(edge), cursor: "grab" }}
          onPointerDown={(event) => onPointerDown(node.id, event)}
        />
      ))}
    </div>
  );
}

function moveHandleStyle(edge: "top" | "right" | "bottom" | "left") {
  const thickness = 8;
  switch (edge) {
    case "top":
      return { left: 0, right: 0, top: -thickness / 2, height: thickness };
    case "right":
      return { top: 0, right: -thickness / 2, bottom: 0, width: thickness };
    case "bottom":
      return { left: 0, right: 0, bottom: -thickness / 2, height: thickness };
    case "left":
      return { top: 0, left: -thickness / 2, bottom: 0, width: thickness };
  }
}

function chromeZIndexForNode(elevated: boolean, zIndex: number) {
  return elevated
    ? Math.max(zIndex, STAGE_CHROME_Z_INDEX.inlineEditor + 1)
    : zIndex;
}

function SlideChromeFrame({
  variant,
}: {
  variant: "selected" | "preselected";
}) {
  const chrome = selectionFrameChrome(variant);
  const color = "var(--ds-accent-fill, #6366f1)";
  return (
    <div
      aria-hidden="true"
      data-slide-chrome-frame={variant}
      className="pointer-events-none absolute inset-0 box-border"
      style={{
        border: `${chrome.borderWidthPx}px solid ${color}`,
        opacity: chrome.opacity,
        zIndex: chrome.zIndex,
      }}
    />
  );
}

function nodeChromeOverlayFrameStyle(
  node: ResolvedRenderNode,
  zIndex: number,
): CSSProperties {
  return {
    ...frameToCss(node.layout.frame),
    ...nodeLayoutTransformToCss(node.layout),
    zIndex,
  };
}

function connectorEndpointPoint(
  endpoint: Extract<
    ResolvedRenderNode["content"],
    { type: "connector" }
  >["content"]["from"],
): { x: number; y: number } {
  if (endpoint.kind === "point") return endpoint.point;
  switch (endpoint.anchor) {
    case "top":
      return { x: 50, y: 0 };
    case "right":
      return { x: 100, y: 50 };
    case "bottom":
      return { x: 50, y: 100 };
    case "left":
      return { x: 0, y: 50 };
    case "center":
    default:
      return { x: 50, y: 50 };
  }
}

function boundsForNodes(
  nodes: readonly ResolvedRenderNode[],
): { x: number; y: number; w: number; h: number } | null {
  if (nodes.length === 0) return null;
  const transformedBounds = nodes.map(transformedNodeBounds);
  const left = Math.min(...transformedBounds.map((bounds) => bounds.left));
  const top = Math.min(...transformedBounds.map((bounds) => bounds.top));
  const right = Math.max(...transformedBounds.map((bounds) => bounds.right));
  const bottom = Math.max(...transformedBounds.map((bounds) => bounds.bottom));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function transformedNodeBounds(node: ResolvedRenderNode): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { x, y, w, h } = node.layout.frame;
  const rotation = node.layout.rotation ?? 0;
  if (rotation % 360 === 0) {
    return { left: x, top: y, right: x + w, bottom: y + h };
  }
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const transformedCorners = corners.map(([cornerX, cornerY]) => {
    const localX = cornerX - centerX;
    const localY = cornerY - centerY;
    return {
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    };
  });
  const xs = transformedCorners.map((corner) => corner.x);
  const ys = transformedCorners.map((corner) => corner.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function resizeHandleStyle(handle: ResizeHandlePosition): CSSProperties {
  const horizontal = handle.includes("w")
    ? { left: 0, transform: "translate(-50%, -50%)" }
    : handle.includes("e")
      ? { left: "100%", transform: "translate(-50%, -50%)" }
      : { left: "50%", transform: "translate(-50%, -50%)" };
  const vertical = handle.includes("n")
    ? { top: 0 }
    : handle.includes("s")
      ? { top: "100%" }
      : { top: "50%" };
  return { ...horizontal, ...vertical };
}

function cropHandleStyle(handle: CropHandlePosition): CSSProperties {
  if (handle === "top" || handle === "bottom") {
    return {
      left: "50%",
      top: handle === "top" ? 0 : "100%",
      width: 34,
      height: 7,
      transform: "translate(-50%, -50%)",
      cursor: "ns-resize",
    };
  }
  return {
    left: handle === "left" ? 0 : "100%",
    top: "50%",
    width: 7,
    height: 34,
    transform: "translate(-50%, -50%)",
    cursor: "ew-resize",
  };
}
