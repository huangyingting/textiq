"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { createOperationIdempotencyKey } from "@/lib/ai/idempotency-key";
import { computeAnchoredPosition } from "@/lib/anchored-position";
import type { VisualGenerationActionPort } from "@/lib/action-ports";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";
import { loadBrandStyles } from "@/lib/brand/brand-list-client";
import type { BrandStyle } from "@/lib/brand/schema";
import { isCreditError, stampSourceText } from "@/lib/visual/generate";
import { mergeVisualContent } from "@/lib/visual/transforms";
import type { Visual } from "@/lib/visual/schema";

// ---------------------------------------------------------------------------
// Section navigation type (shared between hooks and component)
// ---------------------------------------------------------------------------

export type MenuSection =
  | "export"
  | "effects"
  | "colors"
  | "fonts"
  | "icon"
  | "size"
  | "layout"
  | "branding"
  | "sync"
  | "info"
  | "variations";

// ---------------------------------------------------------------------------
// Layout constants used by the position hook
// ---------------------------------------------------------------------------

const POPOVER_GAP = 8;
const EDGE_INSET = 8;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function visualPromptText(visual: Visual): string {
  const parts: string[] = [];
  if (visual.title && visual.title.trim().length > 0)
    parts.push(visual.title.trim());
  for (const node of visual.nodes) {
    if (node.label && node.label.trim().length > 0)
      parts.push(node.label.trim());
  }
  return parts.join("\n");
}

function findVisualNodeElement(
  root: HTMLElement,
  nodeId: string | null,
): Element | null {
  if (!nodeId) return null;
  for (const element of root.querySelectorAll("[data-node-id]")) {
    if (element.getAttribute("data-node-id") === nodeId) {
      return element;
    }
  }
  return null;
}

interface OperationIdempotencyState {
  fingerprint: string;
  key: string;
}

function resolveOperationIdempotencyKey(args: {
  current: OperationIdempotencyState | null;
  operation: "visual-generate" | "visual-sync";
  fingerprint: string;
}): OperationIdempotencyState {
  if (args.current?.fingerprint === args.fingerprint) {
    return args.current;
  }
  return {
    fingerprint: args.fingerprint,
    key: createOperationIdempotencyKey(args.operation),
  };
}

// ---------------------------------------------------------------------------
// useBrandContext
// ---------------------------------------------------------------------------

/**
 * Lazily loads saved brand styles and triggers the fetch when the branding
 * section becomes active.
 */
export function useBrandContext(activeSection: MenuSection | null) {
  const [brands, setBrands] = useState<BrandStyle[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      // Keep effect-triggered loading updates outside the synchronous effect
      // boundary while the ref still closes the duplicate-activation window.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setStatus("loading");
      const nextBrands = await loadBrandStyles(controller.signal);
      if (controller.signal.aborted) return;
      setBrands(nextBrands);
      setStatus("done");
    } catch {
      if (!controller.signal.aborted) {
        setStatus("error");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "branding" || status !== "idle") return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [activeSection, load, status]);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  return { brands, status, retry: load };
}

// ---------------------------------------------------------------------------
// usePopoverGeneration
// ---------------------------------------------------------------------------

interface UsePopoverGenerationOptions {
  visualRef: RefObject<Visual>;
  visualGenerationPort: VisualGenerationActionPort;
  visual: Visual;
  onChange: (next: Visual) => void;
  onCommand?: (payload: VisualCommandPayload, coalesceKey?: string) => void;
  onSectionChange: (section: MenuSection | null) => void;
}

/**
 * Manages the AI-variations generation flow inside the visual context popover.
 * Orchestrates request state, candidate collection, and candidate selection.
 */
export function usePopoverGeneration({
  visualRef,
  visualGenerationPort,
  visual,
  onChange,
  onCommand,
  onSectionChange,
}: UsePopoverGenerationOptions) {
  const [genStatus, setGenStatus] = useState<"idle" | "loading">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [genCreditError, setGenCreditError] = useState(false);
  const [candidates, setCandidates] = useState<Visual[]>([]);
  const operationIdempotencyRef = useRef<OperationIdempotencyState | null>(
    null,
  );

  const reset = useCallback(() => {
    setCandidates([]);
    setGenError(null);
    setGenCreditError(false);
    operationIdempotencyRef.current = null;
  }, []);

  const runGenerate = useCallback(async () => {
    const promptText = visualPromptText(visualRef.current);
    if (promptText.trim().length === 0) {
      setGenError("Add some labels before generating variations.");
      onSectionChange("variations");
      return;
    }
    setGenStatus("loading");
    setGenError(null);
    setGenCreditError(false);
    setCandidates([]);
    const nextOperationIdempotency = resolveOperationIdempotencyKey({
      current: operationIdempotencyRef.current,
      operation: "visual-generate",
      fingerprint: promptText.trim(),
    });
    operationIdempotencyRef.current = nextOperationIdempotency;
    const result = await visualGenerationPort.requestVisualCandidates(
      promptText,
      undefined,
      { idempotencyKey: nextOperationIdempotency.key },
    );
    if (result.ok) {
      setCandidates(result.candidates);
      onSectionChange("variations");
    } else {
      setGenError(result.error);
      setGenCreditError(isCreditError(result));
      onSectionChange("variations");
    }
    setGenStatus("idle");
  }, [visualGenerationPort, visualRef, onSectionChange]);

  const chooseCandidate = useCallback(
    (candidate: Visual) => {
      const next = { ...candidate, autoLayout: visual.autoLayout };
      if (onCommand) {
        onCommand({ op: "visual.merge_content", newVisual: next });
      } else {
        onChange(next);
      }
      setCandidates([]);
      onSectionChange(null);
    },
    [onChange, onCommand, visual, onSectionChange],
  );

  return {
    genStatus,
    genError,
    genCreditError,
    candidates,
    runGenerate,
    chooseCandidate,
    reset,
  };
}

// ---------------------------------------------------------------------------
// useVisualSync
// ---------------------------------------------------------------------------

interface UseVisualSyncOptions {
  visualRef: RefObject<Visual>;
  visualGenerationPort: VisualGenerationActionPort;
  currentSourceText?: string;
  onChange: (next: Visual) => void;
  onCommand?: (payload: VisualCommandPayload, coalesceKey?: string) => void;
  onSectionChange: (section: MenuSection | null) => void;
}

/**
 * Manages the "Sync with Text" re-generation flow: fetches a fresh visual
 * from the anchor block's current source text and merges it into the existing
 * visual, preserving its layout.
 */
export function useVisualSync({
  visualRef,
  visualGenerationPort,
  currentSourceText,
  onChange,
  onCommand,
  onSectionChange,
}: UseVisualSyncOptions) {
  const [syncStatus, setSyncStatus] = useState<"idle" | "loading">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const operationIdempotencyRef = useRef<OperationIdempotencyState | null>(
    null,
  );

  const reset = useCallback(() => {
    setSyncError(null);
    operationIdempotencyRef.current = null;
  }, []);

  const runSync = useCallback(async () => {
    const syncText = (
      currentSourceText ??
      visualRef.current.sourceText ??
      ""
    ).trim();
    if (!syncText) {
      setSyncError("No source text to sync from.");
      return;
    }
    setSyncStatus("loading");
    setSyncError(null);
    const nextOperationIdempotency = resolveOperationIdempotencyKey({
      current: operationIdempotencyRef.current,
      operation: "visual-sync",
      fingerprint: syncText,
    });
    operationIdempotencyRef.current = nextOperationIdempotency;
    const result = await visualGenerationPort.requestVisualCandidates(
      syncText,
      undefined,
      { idempotencyKey: nextOperationIdempotency.key },
    );
    if (result.ok) {
      const refreshed = stampSourceText(result.candidates[0], syncText);
      if (onCommand) {
        onCommand({ op: "visual.merge_content", newVisual: refreshed });
      } else {
        const merged = mergeVisualContent(visualRef.current, refreshed);
        onChange(stampSourceText(merged, syncText));
      }
      onSectionChange(null);
      setSyncStatus("idle");
      return;
    }
    setSyncError(
      result.error === "We couldn't generate a visual. Please try again."
        ? "Sync failed. Please try again."
        : result.error,
    );
    setSyncStatus("idle");
  }, [
    currentSourceText,
    onChange,
    onCommand,
    visualGenerationPort,
    visualRef,
    onSectionChange,
  ]);

  return { syncStatus, syncError, runSync, reset };
}

// ---------------------------------------------------------------------------
// usePopoverPosition
// ---------------------------------------------------------------------------

interface UsePopoverPositionOptions {
  mode: "float" | "panel";
  anchorRef: RefObject<HTMLElement | null>;
  measureRef: RefObject<HTMLDivElement | null>;
  toolbarRef: RefObject<HTMLDivElement | null>;
  componentContext: boolean;
  selectedNodeId: string | null;
  popoverExpanded: boolean;
  onClose: () => void;
}

/**
 * Computes and maintains the fixed-viewport coordinates for the popover using
 * `computeAnchoredPosition`. Also handles scroll-dismiss and click-away in
 * float mode.
 */
export function usePopoverPosition({
  mode,
  anchorRef,
  measureRef,
  toolbarRef,
  componentContext,
  selectedNodeId,
  popoverExpanded,
  onClose,
}: UsePopoverPositionOptions) {
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: -1000,
    left: -1000,
  });

  const reposition = useCallback(() => {
    if (mode !== "float") return;
    const anchor = anchorRef.current;
    const el = measureRef.current;
    if (!anchor || !el) return;
    const toolbar = toolbarRef.current;
    const componentAnchor = componentContext
      ? findVisualNodeElement(anchor, selectedNodeId)
      : null;
    const rect = (componentAnchor ?? anchor).getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const toolbarRect = toolbar?.getBoundingClientRect();
    const toolbarOffset = toolbarRect
      ? {
          top: toolbarRect.top - elRect.top,
          left: toolbarRect.left - elRect.left,
        }
      : { top: 0, left: 0 };
    const width = toolbarRect?.width ?? el.offsetWidth;
    const height = toolbarRect?.height ?? el.offsetHeight;
    const positionedToolbar = computeAnchoredPosition({
      anchor: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      float: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: componentContext ? "right" : "top",
      gap: POPOVER_GAP,
      padding: EDGE_INSET,
    });
    const top = positionedToolbar.top - toolbarOffset.top;
    const left = positionedToolbar.left - toolbarOffset.left;
    setCoords((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [
    anchorRef,
    componentContext,
    measureRef,
    mode,
    selectedNodeId,
    toolbarRef,
  ]);

  useLayoutEffect(() => {
    if (mode !== "float") return;
    reposition();
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
    };
  }, [mode, reposition]);

  // Dismiss floating visual/component toolbars on document scroll. Internal
  // scrolling inside the popover (for long menus/pickers) should remain usable.
  useEffect(() => {
    if (mode !== "float") return;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest("[data-visual-chrome]") ||
          target.closest("[data-ds-floating]"))
      ) {
        return;
      }
      if (popoverExpanded) {
        reposition();
        return;
      }
      onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [mode, onClose, popoverExpanded, reposition]);

  // Click-away: dismiss when a pointer-down lands outside any visual chrome.
  // Only active in float mode.
  useEffect(() => {
    if (mode !== "float") return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest("[data-visual-chrome]") ||
        target?.closest("[data-ds-floating]")
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [mode, onClose]);

  return { coords };
}
