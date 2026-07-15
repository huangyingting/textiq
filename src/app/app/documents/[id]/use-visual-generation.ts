"use client";

import { useCallback, useRef, useState } from "react";

import { createOperationIdempotencyKey } from "@/lib/ai/idempotency-key";
import {
  isCreditError,
  requestVisualCandidates,
  stampSourceText,
} from "@/lib/visual/generate";
import type { VisualGenerationActionPort } from "@/lib/action-ports";
import type { DetailLevel, Orientation } from "@/lib/ai/prompt";
import {
  bucketCount,
  bucketDurationMs,
  emitProductTelemetry,
} from "@/lib/telemetry/product";
import type { Visual, VisualKind } from "@/lib/visual/schema";

export type GenStatus = "idle" | "loading";

export const VISUAL_KIND_CATEGORY_ORDER = [
  { id: "mindmap", label: "Mindmap" },
  { id: "process", label: "Process" },
  { id: "data", label: "Data" },
  { id: "timelines", label: "Timelines" },
  { id: "comparison", label: "Comparison" },
  { id: "business", label: "Business Frameworks" },
  { id: "more", label: "More visuals" },
] as const;

export type VisualKindCategoryId =
  (typeof VISUAL_KIND_CATEGORY_ORDER)[number]["id"];
export type VisualResultSectionId = "ai" | VisualKindCategoryId;

export const VISUAL_KIND_CATEGORY: Partial<
  Record<VisualKind, VisualKindCategoryId>
> = {
  mindmap: "mindmap",
  concept: "mindmap",
  orgchart: "mindmap",
  flowchart: "process",
  list: "process",
  cycle: "process",
  funnel: "process",
  chart: "data",
  matrix: "data",
  timeline: "timelines",
  comparison: "comparison",
  venn: "comparison",
  pyramid: "business",
};

export const MAX_GENERATED_VISUALS_PER_SECTION = 8;

export interface GenOptions {
  type: VisualKind | "auto";
  orientation: Orientation;
  detailLevel: DetailLevel | "auto";
  stayCloserToText: boolean;
}

export const DEFAULT_GEN_OPTIONS: GenOptions = {
  type: "auto",
  orientation: "auto",
  detailLevel: "auto",
  stayCloserToText: false,
};

export const DEFAULT_EXPANDED_VISUAL_CATEGORIES: Record<string, boolean> = {
  ai: true,
  mindmap: true,
  process: true,
};

export function visualResultSectionForType(
  type: GenOptions["type"],
): VisualResultSectionId {
  if (type === "auto") {
    return "ai";
  }
  return VISUAL_KIND_CATEGORY[type] ?? "more";
}

export interface VisualGenerationTarget {
  text: string;
  sourceKind?: "block" | "selection";
}

interface GenerateOptions {
  append?: boolean;
  limit?: number;
  options?: GenOptions;
}

const routeVisualGenerationActions: VisualGenerationActionPort = {
  requestVisualCandidates: (text, options, request) =>
    requestVisualCandidates(text, options, fetch, request),
};

interface OperationIdempotencyState {
  fingerprint: string;
  key: string;
}

function visualOperationFingerprint(input: {
  text: string;
  sourceKind: "block" | "selection";
  options: GenOptions;
}): string {
  return JSON.stringify({
    text: input.text.trim(),
    sourceKind: input.sourceKind,
    options: {
      type: input.options.type,
      orientation: input.options.orientation,
      detailLevel: input.options.detailLevel,
      stayCloserToText: input.options.stayCloserToText,
    },
  });
}

export function useVisualGeneration(
  actions: VisualGenerationActionPort = routeVisualGenerationActions,
) {
  const [status, setStatus] = useState<GenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorSection, setErrorSection] =
    useState<VisualResultSectionId | null>(null);
  const [creditError, setCreditError] = useState(false);
  const [activeGenerationSection, setActiveGenerationSection] =
    useState<VisualResultSectionId | null>(null);
  const [generatedVisualsBySection, setGeneratedVisualsBySection] = useState<
    Partial<Record<VisualResultSectionId, Visual[]>>
  >({});
  const [genOptions, setGenOptions] = useState<GenOptions>(DEFAULT_GEN_OPTIONS);
  const sourceTextRef = useRef("");
  const operationIdempotencyRef = useRef<OperationIdempotencyState | null>(
    null,
  );

  const resetGeneration = useCallback((keepOptions = true) => {
    setGeneratedVisualsBySection({});
    setError(null);
    setErrorSection(null);
    setStatus("idle");
    setActiveGenerationSection(null);
    setCreditError(false);
    sourceTextRef.current = "";
    operationIdempotencyRef.current = null;
    if (!keepOptions) {
      setGenOptions(DEFAULT_GEN_OPTIONS);
    }
  }, []);

  const generate = useCallback(
    async (
      target: VisualGenerationTarget,
      generateOptions: GenerateOptions = {},
    ) => {
      const opts = generateOptions.options ?? genOptions;
      const section = visualResultSectionForType(opts.type);
      const append = generateOptions.append ?? true;
      const limit = generateOptions.limit ?? MAX_GENERATED_VISUALS_PER_SECTION;
      const sourceKind = target.sourceKind ?? "block";
      const inputSizeBucket = bucketCount(
        target.text.trim() === "" ? 0 : target.text.trim().split(/\s+/).length,
      );
      const startedAt = performance.now();
      const operationFingerprint = visualOperationFingerprint({
        text: target.text,
        sourceKind,
        options: opts,
      });
      const operationIdempotency = operationIdempotencyRef.current;
      const idempotencyKey =
        operationIdempotency?.fingerprint === operationFingerprint
          ? operationIdempotency.key
          : createOperationIdempotencyKey("visual-generate");
      operationIdempotencyRef.current = {
        fingerprint: operationFingerprint,
        key: idempotencyKey,
      };

      sourceTextRef.current = target.text.trim();
      setStatus("loading");
      setActiveGenerationSection(section);
      setError(null);
      setErrorSection(null);
      setCreditError(false);
      emitProductTelemetry("product.ai.visual.started", {
        detailLevel: opts.detailLevel,
        inputSizeBucket,
        orientation: opts.orientation,
        sourceKind,
        visualKind: opts.type,
      });

      const result = await actions.requestVisualCandidates(
        target.text,
        {
          type: opts.type,
          orientation: opts.orientation,
          detailLevel: opts.detailLevel,
          stayCloserToText: opts.stayCloserToText,
        },
        {
          idempotencyKey,
        },
      );

      setStatus("idle");
      setActiveGenerationSection(null);
      if (result.ok) {
        emitProductTelemetry("product.ai.visual.candidates", {
          candidateCount: result.candidates.length,
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          inputSizeBucket,
          sourceKind,
          visualKind: opts.type,
        });
        setGeneratedVisualsBySection((current) => ({
          ...current,
          [section]: append
            ? [...result.candidates, ...(current[section] ?? [])].slice(
                0,
                limit,
              )
            : result.candidates.slice(0, limit),
        }));
      } else {
        emitProductTelemetry("product.ai.visual.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          failureReason: result.errorKind === "credit" ? "quota" : "unknown",
          inputSizeBucket,
          sourceKind,
          visualKind: opts.type,
        });
        setError(result.error);
        setErrorSection(section);
        setCreditError(isCreditError(result));
      }
      return { ...result, section };
    },
    [actions, genOptions],
  );

  const stampGeneratedVisual = useCallback(
    (visual: Visual) => stampSourceText(visual, sourceTextRef.current),
    [],
  );

  return {
    status,
    error,
    errorSection,
    creditError,
    activeGenerationSection,
    generatedVisualsBySection,
    genOptions,
    setGenOptions,
    setGeneratedVisualsBySection,
    generate,
    resetGeneration,
    stampGeneratedVisual,
  };
}
