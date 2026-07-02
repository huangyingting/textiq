"use client";

/**
 * React hook layer for the AI "document → presentation Deck" generation request
 * used by the slide-editor open path (issue #268).
 *
 * The pure, DOM-free request-shaping / parsing / error-classification logic
 * lives in {@link "@/lib/ai/deck-generation-request"} (so it can be unit-tested
 * under `node --test`, mirroring how `@/lib/visual/generate` separates
 * `requestVisualCandidates`). This module layers React state, staged progress
 * (via {@link useGenerationStatus}), and a cancel/reset affordance on top.
 *
 * Every failure mode — network error, timeout, credit/quota, and the 404
 * returned when the server feature flag is OFF — is classified so the caller can
 * transparently fall back to the deterministic derive path.
 */

import { useCallback, useRef, useState } from "react";

import {
  requestDeckGeneration,
  type DeckGenerateError,
  type DeckGenerateResult,
  type DeckGenerationOptions,
} from "@/lib/ai/deck-generation-request";
import type { ThemePackageId } from "@/lib/presentation/theme-package-ids";
import { useGenerationStatus } from "@/lib/ai/use-generation-status";
import type { Deck } from "@/lib/presentation/schema";
import {
  bucketBytes,
  bucketDurationMs,
  emitProductTelemetry,
} from "@/lib/telemetry/product";

export type {
  DeckGenerateError,
  DeckGenerateErrorKind,
  DeckGenerateResult,
  DeckGenerationOptions,
} from "@/lib/ai/deck-generation-request";

/** Lifecycle of a deck-generation request. */
export type DeckGenerationStatus = "idle" | "loading" | "success" | "error";

export interface UseDeckGenerationResult {
  /** Kick off a generation for the given document content + options. */
  generate: (
    contentJson: unknown,
    options?: DeckGenerationOptions,
    request?: {
      themePackageId?: ThemePackageId;
    },
  ) => Promise<DeckGenerateResult>;
  /** Current lifecycle status. */
  status: DeckGenerationStatus;
  /** Descriptive staged-progress label while loading (e.g. "Building structure…"). */
  stage: string;
  /** True only for the first generation of the session (surface the ETA hint). */
  showEta: boolean;
  /** ETA hint string, e.g. "~10–15 s". */
  etaHint: string;
  /** The generated presentation deck on success, else `null`. */
  deck: Deck | null;
  /** Whether the source outline was trimmed to fit the input budget. */
  truncated: boolean;
  /** The classified error on failure, else `null`. */
  error: DeckGenerateError | null;
  /** Cancel any in-flight request and reset all state back to idle. */
  reset: () => void;
}

/**
 * React hook wrapping {@link requestDeckGeneration} with lifecycle state and
 * staged progress. `reset` doubles as the cancel affordance: it aborts an
 * in-flight request and clears state, so the caller can wire it to a Cancel
 * button.
 */
export function useDeckGeneration(): UseDeckGenerationResult {
  const [status, setStatus] = useState<DeckGenerationStatus>("idle");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<DeckGenerateError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { stageLabel, showEta, etaHint } = useGenerationStatus(
    status === "loading",
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setDeck(null);
    setTruncated(false);
    setError(null);
  }, []);

  const generate = useCallback(
    async (
      contentJson: unknown,
      options: DeckGenerationOptions = {},
      request?: {
        themePackageId?: ThemePackageId;
      },
    ): Promise<DeckGenerateResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("loading");
      setDeck(null);
      setTruncated(false);
      setError(null);
      const serializedLength =
        typeof contentJson === "string"
          ? contentJson.length
          : (JSON.stringify(contentJson)?.length ?? 0);
      const inputSizeBucket = bucketBytes(serializedLength);
      const startedAt = performance.now();
      emitProductTelemetry("product.ai.deck.started", {
        inputSizeBucket,
        optionLength: options.length ?? "default",
        sourceKind: "document",
      });

      const result = await requestDeckGeneration(
        contentJson,
        options,
        fetch,
        controller.signal,
        request,
      );

      // A newer request (or a reset) superseded this one — ignore the result.
      if (abortRef.current !== controller) {
        return result;
      }
      abortRef.current = null;

      if (result.ok) {
        emitProductTelemetry("product.ai.deck.candidate", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          inputSizeBucket,
          optionLength: options.length ?? "default",
          slideCount: result.deck.slides.length,
          truncated: result.truncated,
        });
        setDeck(result.deck);
        setTruncated(result.truncated);
        setStatus("success");
      } else {
        emitProductTelemetry("product.ai.deck.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          failureReason: result.errorKind,
          inputSizeBucket,
          optionLength: options.length ?? "default",
        });
        setError({ message: result.error, kind: result.errorKind });
        setStatus("error");
      }
      return result;
    },
    [],
  );

  return {
    generate,
    status,
    stage: stageLabel,
    showEta,
    etaHint,
    deck,
    truncated,
    error,
    reset,
  };
}
