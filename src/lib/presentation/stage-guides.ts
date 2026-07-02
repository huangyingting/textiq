import type { LayoutBox } from "./schema";

export type StageGuide = {
  axis: "x" | "y";
  positionPct: number;
};

export type SnapFrameResult = {
  frame: LayoutBox["frame"];
  guides: StageGuide[];
};

const DEFAULT_GUIDES = [0, 10, 50, 90, 100] as const;

export type StageGuideInput = {
  axis: "x" | "y";
  positionPct: number;
};

function nearestGuide(
  value: number,
  thresholdPct: number,
  guides: readonly StageGuideInput[],
): StageGuideInput | null {
  let nearest: StageGuideInput | null = null;
  let nearestDistance = thresholdPct;
  for (const guide of guides) {
    const distance = Math.abs(value - guide.positionPct);
    if (distance <= nearestDistance) {
      nearest = guide;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function candidatePositions(frame: LayoutBox["frame"]): {
  axis: "x" | "y";
  value: number;
  apply: (guide: number) => Partial<LayoutBox["frame"]>;
}[] {
  return [
    { axis: "x", value: frame.x, apply: (guide) => ({ x: guide }) },
    {
      axis: "x",
      value: frame.x + frame.w / 2,
      apply: (guide) => ({ x: guide - frame.w / 2 }),
    },
    {
      axis: "x",
      value: frame.x + frame.w,
      apply: (guide) => ({ x: guide - frame.w }),
    },
    { axis: "y", value: frame.y, apply: (guide) => ({ y: guide }) },
    {
      axis: "y",
      value: frame.y + frame.h / 2,
      apply: (guide) => ({ y: guide - frame.h / 2 }),
    },
    {
      axis: "y",
      value: frame.y + frame.h,
      apply: (guide) => ({ y: guide - frame.h }),
    },
  ];
}

function clampFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const w = Math.max(0.5, Math.min(100, frame.w));
  const h = Math.max(0.5, Math.min(100, frame.h));
  return {
    x: Math.max(0, Math.min(100 - w, frame.x)),
    y: Math.max(0, Math.min(100 - h, frame.y)),
    w,
    h,
  };
}

export function snapFrameToStageGuides(
  frame: LayoutBox["frame"],
  thresholdPct = 0.75,
  customGuides: readonly StageGuideInput[] = [],
): SnapFrameResult {
  let snapped = frame;
  const guides: StageGuide[] = [];
  const usedAxes = new Set<"x" | "y">();
  const guideCandidates: StageGuideInput[] = [
    ...DEFAULT_GUIDES.flatMap((positionPct) => [
      { axis: "x" as const, positionPct },
      { axis: "y" as const, positionPct },
    ]),
    ...customGuides,
  ];

  for (const candidate of candidatePositions(frame)) {
    if (usedAxes.has(candidate.axis)) continue;
    const guide = nearestGuide(
      candidate.value,
      thresholdPct,
      guideCandidates.filter((item) => item.axis === candidate.axis),
    );
    if (guide === null) continue;
    snapped = { ...snapped, ...candidate.apply(guide.positionPct) };
    guides.push({ axis: candidate.axis, positionPct: guide.positionPct });
    usedAxes.add(candidate.axis);
  }

  return { frame: clampFrame(snapped), guides };
}

export function alignmentGuidesForFrames(
  frames: readonly LayoutBox["frame"][],
): StageGuideInput[] {
  return frames.flatMap((frame) => [
    { axis: "x" as const, positionPct: frame.x },
    { axis: "x" as const, positionPct: frame.x + frame.w / 2 },
    { axis: "x" as const, positionPct: frame.x + frame.w },
    { axis: "y" as const, positionPct: frame.y },
    { axis: "y" as const, positionPct: frame.y + frame.h / 2 },
    { axis: "y" as const, positionPct: frame.y + frame.h },
  ]);
}
