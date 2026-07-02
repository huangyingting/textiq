import type { JSX } from "react";

import type {
  ConnectorEndpoint,
  ImageCrop,
  LayoutBox,
} from "@/lib/presentation-vnext/schema";
import {
  snapFrameToStageGuides,
  type StageGuide,
  type StageGuideInput,
} from "@/lib/presentation-vnext/stage-guides";
import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation-vnext/stage-chrome";

import type {
  ConnectorEndpointHandle,
  SlideCanvasNodeGestureDraft,
} from "./slide-canvas";

const DEFAULT_CLICK_MOVE_THRESHOLD_PX = 4;

export interface NodeMovePreview {
  patches: Map<string, Partial<LayoutBox>>;
  guides: StageGuide[];
}

export interface StageGestureBadgeModel {
  frame: LayoutBox["frame"];
  label: string;
}

export interface ResizeGestureDraft {
  nodeId: string;
  frame: LayoutBox["frame"];
}

export interface CropGestureDraft {
  nodeId: string;
  crop: ImageCrop;
}

export interface RotationGestureDraft {
  nodeId: string;
  rotation: number;
}

export interface ConnectorGestureDraft {
  nodeId: string;
  endpoint: ConnectorEndpointHandle;
  value: ConnectorEndpoint;
}

interface NodeMovePreviewArgs {
  startClientX: number;
  startClientY: number;
  nextClientX: number;
  nextClientY: number;
  rectWidth: number;
  rectHeight: number;
  originalFrames: ReadonlyMap<string, LayoutBox["frame"]>;
  alignmentGuides: readonly StageGuideInput[];
  snapToGuides?: boolean;
  thresholdPx?: number;
  /**
   * When true, constrains movement to the dominant axis (Shift-drag parity with
   * Canva): the element travels only horizontally or only vertically, whichever
   * the pointer has moved farther along.
   */
  lockAxis?: boolean;
}

function clampStageFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const width = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.w) ? frame.w : 0.5),
  );
  const height = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.h) ? frame.h : 0.5),
  );
  return {
    x: Math.max(
      0,
      Math.min(100 - width, Number.isFinite(frame.x) ? frame.x : 0),
    ),
    y: Math.max(
      0,
      Math.min(100 - height, Number.isFinite(frame.y) ? frame.y : 0),
    ),
    w: width,
    h: height,
  };
}

function stageFramesEqual(
  left: LayoutBox["frame"],
  right: LayoutBox["frame"],
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function nodeMovePatchFramesEqual(
  left: ReadonlyMap<string, Partial<LayoutBox>>,
  right: ReadonlyMap<string, Partial<LayoutBox>>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, patch] of left) {
    const nextPatch = right.get(id);
    if (!nextPatch) return false;
    if (patch.frame || nextPatch.frame) {
      if (!nextPatch.frame || !patch.frame) return false;
      if (!stageFramesEqual(patch.frame, nextPatch.frame)) return false;
    }
    if (patch.rotation !== nextPatch.rotation) return false;
  }
  return true;
}

export function nodeMovePreviewsEqual(
  left: NodeMovePreview,
  right: NodeMovePreview,
): boolean {
  return nodeMovePatchFramesEqual(left.patches, right.patches);
}

export function nodeMoveGestureDrafts(
  preview: NodeMovePreview | null,
): ReadonlyMap<string, SlideCanvasNodeGestureDraft> | null {
  if (!preview || preview.patches.size === 0) return null;
  const drafts = new Map<string, SlideCanvasNodeGestureDraft>();
  for (const [nodeId, patch] of preview.patches) {
    if (!patch.frame && patch.rotation === undefined) continue;
    drafts.set(nodeId, {
      ...(patch.frame ? { frame: patch.frame } : {}),
      ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}),
    });
  }
  return drafts.size > 0 ? drafts : null;
}

function frameBounds(
  frames: readonly LayoutBox["frame"][],
): LayoutBox["frame"] | null {
  if (frames.length === 0) return null;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.w));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function formatStageGestureBadge(
  mode: "move" | "resize",
  frame: LayoutBox["frame"],
): string {
  if (mode === "move") {
    return `${Math.round(frame.x)}, ${Math.round(frame.y)}`;
  }
  return `${Math.round(frame.w)} \u00d7 ${Math.round(frame.h)}`;
}

export function createNodeMovePreview({
  startClientX,
  startClientY,
  nextClientX,
  nextClientY,
  rectWidth,
  rectHeight,
  originalFrames,
  alignmentGuides,
  snapToGuides = true,
  thresholdPx = DEFAULT_CLICK_MOVE_THRESHOLD_PX,
  lockAxis = false,
}: NodeMovePreviewArgs): NodeMovePreview | null {
  if (rectWidth <= 0 || rectHeight <= 0 || originalFrames.size === 0) {
    return null;
  }
  if (
    Math.abs(nextClientX - startClientX) <= thresholdPx &&
    Math.abs(nextClientY - startClientY) <= thresholdPx
  ) {
    return null;
  }

  let pointerDeltaX = nextClientX - startClientX;
  let pointerDeltaY = nextClientY - startClientY;
  const axisLockedX =
    lockAxis && Math.abs(pointerDeltaX) >= Math.abs(pointerDeltaY);
  const axisLockedY = lockAxis && !axisLockedX;
  if (axisLockedX) pointerDeltaY = 0;
  if (axisLockedY) pointerDeltaX = 0;

  const deltaX = (pointerDeltaX / rectWidth) * 100;
  const deltaY = (pointerDeltaY / rectHeight) * 100;
  const patches = new Map<string, Partial<LayoutBox>>();
  const guides: StageGuide[] = [];

  if (originalFrames.size > 1) {
    const originalBounds = frameBounds([...originalFrames.values()]);
    if (!originalBounds) return null;
    const nextBounds = clampStageFrame({
      ...originalBounds,
      x: originalBounds.x + deltaX,
      y: originalBounds.y + deltaY,
    });
    const snapped = snapToGuides
      ? snapFrameToStageGuides(nextBounds, 0.75, alignmentGuides)
      : { frame: nextBounds, guides: [] as StageGuide[] };
    const lockedBounds = {
      ...snapped.frame,
      ...(axisLockedY ? { x: originalBounds.x } : {}),
      ...(axisLockedX ? { y: originalBounds.y } : {}),
    };
    const appliedDeltaX = lockedBounds.x - originalBounds.x;
    const appliedDeltaY = lockedBounds.y - originalBounds.y;
    for (const [id, frame] of originalFrames) {
      patches.set(id, {
        frame: {
          ...frame,
          x: frame.x + appliedDeltaX,
          y: frame.y + appliedDeltaY,
        },
      });
    }
    guides.push(...snapped.guides);
    return { patches, guides };
  }

  for (const [id, frame] of originalFrames) {
    const nextFrame = clampStageFrame({
      ...frame,
      x: frame.x + deltaX,
      y: frame.y + deltaY,
    });
    const snapped = snapToGuides
      ? snapFrameToStageGuides(nextFrame, 0.75, alignmentGuides)
      : { frame: nextFrame, guides: [] as StageGuide[] };
    // Keep the axis lock strict: snapping may only nudge the free axis, never
    // the locked one, so a Shift-drag stays on a perfectly straight line.
    const lockedFrame = {
      ...snapped.frame,
      ...(axisLockedY ? { x: frame.x } : {}),
      ...(axisLockedX ? { y: frame.y } : {}),
    };
    patches.set(id, {
      frame: lockedFrame,
    });
    guides.push(...snapped.guides);
  }
  return { patches, guides };
}

export function buildStageNodeGestureDrafts({
  moveGestureDraft,
  resizeGestureDraft,
  cropGestureDraft,
  rotationGestureDraft,
  connectorGestureDraft,
}: {
  moveGestureDraft: ReadonlyMap<string, SlideCanvasNodeGestureDraft> | null;
  resizeGestureDraft: ResizeGestureDraft | null;
  cropGestureDraft: CropGestureDraft | null;
  rotationGestureDraft: RotationGestureDraft | null;
  connectorGestureDraft: ConnectorGestureDraft | null;
}): ReadonlyMap<string, SlideCanvasNodeGestureDraft> | undefined {
  const drafts = new Map<string, SlideCanvasNodeGestureDraft>();
  if (moveGestureDraft) {
    for (const [nodeId, draft] of moveGestureDraft) {
      drafts.set(nodeId, {
        ...(drafts.get(nodeId) ?? {}),
        ...draft,
      });
    }
  }
  if (resizeGestureDraft) {
    drafts.set(resizeGestureDraft.nodeId, {
      frame: resizeGestureDraft.frame,
    });
  }
  if (cropGestureDraft) {
    drafts.set(cropGestureDraft.nodeId, {
      ...(drafts.get(cropGestureDraft.nodeId) ?? {}),
      crop: cropGestureDraft.crop,
    });
  }
  if (rotationGestureDraft) {
    drafts.set(rotationGestureDraft.nodeId, {
      ...(drafts.get(rotationGestureDraft.nodeId) ?? {}),
      rotation: rotationGestureDraft.rotation,
    });
  }
  if (connectorGestureDraft) {
    drafts.set(connectorGestureDraft.nodeId, {
      ...(drafts.get(connectorGestureDraft.nodeId) ?? {}),
      connectorEndpoints: {
        ...(drafts.get(connectorGestureDraft.nodeId)?.connectorEndpoints ?? {}),
        [connectorGestureDraft.endpoint]: connectorGestureDraft.value,
      },
    });
  }
  return drafts.size > 0 ? drafts : undefined;
}

export function buildStageGestureBadge({
  moveGestureDraft,
  resizeGestureDraft,
}: {
  moveGestureDraft: ReadonlyMap<string, SlideCanvasNodeGestureDraft> | null;
  resizeGestureDraft: ResizeGestureDraft | null;
}): StageGestureBadgeModel | null {
  if (resizeGestureDraft) {
    return {
      frame: resizeGestureDraft.frame,
      label: formatStageGestureBadge("resize", resizeGestureDraft.frame),
    };
  }
  if (moveGestureDraft) {
    const frame = frameBounds(
      [...moveGestureDraft.values()]
        .map((draft) => draft.frame)
        .filter((frame): frame is LayoutBox["frame"] => frame !== undefined),
    );
    return frame
      ? { frame, label: formatStageGestureBadge("move", frame) }
      : null;
  }
  return null;
}

export function renderStageGestureBadge(
  badge: StageGestureBadgeModel | null,
): JSX.Element | null {
  if (!badge) return null;
  return (
    <div
      aria-hidden="true"
      data-stage-gesture-badge="true"
      className="pointer-events-none absolute rounded-ds-sm bg-ds-inverse-surface px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ds-inverse-text"
      style={{
        left: `${badge.frame.x + badge.frame.w / 2}%`,
        top: `calc(${badge.frame.y + badge.frame.h}% + 6px)`,
        transform: "translateX(-50%)",
        zIndex: STAGE_CHROME_Z_INDEX.liveBadge,
      }}
    >
      {badge.label}
    </div>
  );
}
