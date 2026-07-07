"use client";

import type { JSX } from "react";

import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";
import { FOCUS_RING } from "@/components/ui/tokens";
import {
  clampLayoutFrame,
  parseFiniteNumberInput,
} from "./numeric-sanitization";

export interface NodeGeometryPanelProps {
  node: SlideChildNode;
  onUpdateLayout: (patch: Partial<LayoutBox>) => void;
  onUpdateAttributes: (patch: { locked?: boolean; hidden?: boolean }) => void;
}

export function nextFrameForPatch(
  layout: LayoutBox,
  patch: Partial<LayoutBox["frame"]>,
): LayoutBox["frame"] {
  const frame = layout.frame;
  const nextPatch: Partial<LayoutBox["frame"]> = {};
  if (Number.isFinite(patch.x)) nextPatch.x = patch.x;
  if (Number.isFinite(patch.y)) nextPatch.y = patch.y;
  if (Number.isFinite(patch.w)) nextPatch.w = patch.w;
  if (Number.isFinite(patch.h)) nextPatch.h = patch.h;
  const nextFrame = { ...frame, ...nextPatch };
  if (layout.constraints?.preserveAspectRatio) {
    const aspect = frame.w / frame.h;
    if (Number.isFinite(aspect) && aspect > 0) {
      if (nextPatch.w !== undefined && nextPatch.h === undefined) {
        nextFrame.h = nextPatch.w / aspect;
      } else if (nextPatch.h !== undefined && nextPatch.w === undefined) {
        nextFrame.w = nextPatch.h * aspect;
      }
    }
  }
  return clampLayoutFrame(nextFrame);
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 0.5,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-1 text-xs text-ds-text-secondary"
    >
      {label}
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = parseFiniteNumberInput(event.currentTarget.value);
          if (next === undefined) return;
          onChange(next);
        }}
        className={`w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-[12px] text-ds-text-primary outline-none ${FOCUS_RING}`}
      />
    </label>
  );
}

export function NodeGeometryPanel({
  node,
  onUpdateLayout,
  onUpdateAttributes,
}: NodeGeometryPanelProps): JSX.Element | null {
  const layout = node.layout;
  if (!layout) return null;
  const currentLayout = layout;
  const frame = layout.frame;

  function updateFrame(patch: Partial<LayoutBox["frame"]>) {
    onUpdateLayout({ frame: nextFrameForPatch(currentLayout, patch) });
  }

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Geometry
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="presentation-node-x"
          label="X"
          value={frame.x}
          min={0}
          max={100}
          onChange={(x) => updateFrame({ x })}
        />
        <NumberField
          id="presentation-node-y"
          label="Y"
          value={frame.y}
          min={0}
          max={100}
          onChange={(y) => updateFrame({ y })}
        />
        <NumberField
          id="presentation-node-w"
          label="W"
          value={frame.w}
          min={0.5}
          max={100}
          onChange={(w) => updateFrame({ w })}
        />
        <NumberField
          id="presentation-node-h"
          label="H"
          value={frame.h}
          min={0.5}
          max={100}
          onChange={(h) => updateFrame({ h })}
        />
        <NumberField
          id="presentation-node-rotation"
          label="Rotation"
          value={layout.rotation ?? 0}
          step={1}
          onChange={(rotation) => onUpdateLayout({ rotation })}
        />
      </div>
      <div className="mt-1 flex items-center gap-4 text-xs text-ds-text-secondary">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={layout.autoHeight === true}
            onChange={(event) =>
              onUpdateLayout({ autoHeight: event.currentTarget.checked })
            }
          />
          Auto height
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={layout.constraints?.preserveAspectRatio === true}
            onChange={(event) =>
              onUpdateLayout({
                constraints: {
                  ...layout.constraints,
                  preserveAspectRatio: event.currentTarget.checked,
                },
              })
            }
          />
          Aspect lock
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={layout.flipX === true}
            onChange={(event) =>
              onUpdateLayout({ flipX: event.currentTarget.checked })
            }
          />
          Flip H
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={layout.flipY === true}
            onChange={(event) =>
              onUpdateLayout({ flipY: event.currentTarget.checked })
            }
          />
          Flip V
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={node.locked === true}
            onChange={(event) =>
              onUpdateAttributes({ locked: event.currentTarget.checked })
            }
          />
          Locked
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={node.hidden === true}
            onChange={(event) =>
              onUpdateAttributes({ hidden: event.currentTarget.checked })
            }
          />
          Hidden
        </label>
      </div>
    </section>
  );
}
