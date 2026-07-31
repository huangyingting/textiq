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
 * returned when the server feature flag is OFF — is classified separately from
 * cancellation so the caller can fall back only for genuine failures.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { createOperationIdempotencyKey } from "@/lib/ai/idempotency-key";
import {
  requestDeckGeneration,
  type DeckGenerateCancelKind,
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
  DeckGenerateCancelKind,
  DeckGenerateError,
  DeckGenerateErrorKind,
  DeckGenerateResult,
  DeckGenerationOptions,
} from "@/lib/ai/deck-generation-request";

/** Lifecycle of a deck-generation request. */
export type DeckGenerationStatus = "idle" | "loading" | "success" | "error";

interface DeckGenerationRequest {
  themePackageId?: ThemePackageId;
  idempotencyKey?: string;
}

interface OperationIdempotencyState {
  fingerprint: string;
  key: string;
}

interface ActiveGenerationOperation {
  token: object;
  promise: Promise<DeckGenerateResult>;
}

export interface UseDeckGenerationResult {
  /** Kick off a generation for the given document content + options. */
  generate: (
    contentJson: unknown,
    options?: DeckGenerationOptions,
    request?: DeckGenerationRequest,
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
  const activeGenerationRef = useRef<ActiveGenerationOperation | null>(null);
  const activationLockRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelReasonRef = useRef<
    WeakMap<AbortController, DeckGenerateCancelKind>
  >(new WeakMap());
  const operationIdempotencyRef = useRef<OperationIdempotencyState | null>(
    null,
  );

  const { stageLabel, showEta, etaHint } = useGenerationStatus(
    status === "loading",
  );

  // Same-render duplicate activation shares the active request. A later
  // rendered interaction can still intentionally supersede it with new input.
  useEffect(() => {
    activationLockRef.current = false;
  });

  useEffect(() => {
    const cancelReasons = cancelReasonRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activationLockRef.current = false;
      activeGenerationRef.current = null;
      operationIdempotencyRef.current = null;
      const controller = abortRef.current;
      if (controller) {
        cancelReasons.set(controller, "canceled");
        controller.abort();
      }
      abortRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      cancelReasonRef.current.set(abortRef.current, "canceled");
      abortRef.current.abort();
    }
    abortRef.current = null;
    activeGenerationRef.current = null;
    activationLockRef.current = false;
    operationIdempotencyRef.current = null;
    if (!mountedRef.current) return;
    setStatus("idle");
    setDeck(null);
    setTruncated(false);
    setError(null);
  }, []);

  const generate = useCallback(
    (
      contentJson: unknown,
      options: DeckGenerationOptions = {},
      request?: DeckGenerationRequest,
    ): Promise<DeckGenerateResult> => {
      if (activationLockRef.current) {
        const activeOperation = activeGenerationRef.current;
        if (activeOperation) return activeOperation.promise;
      }
      activationLockRef.current = true;
      const token = {};

      const execute = async (): Promise<DeckGenerateResult> => {
        if (abortRef.current) {
          cancelReasonRef.current.set(abortRef.current, "superseded");
          abortRef.current.abort();
        }
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
        const operationFingerprint = JSON.stringify({
          contentJson:
            typeof contentJson === "string"
              ? contentJson
              : (JSON.stringify(contentJson) ?? "null"),
          options: {
            length: options.length ?? null,
            tone: options.tone?.trim() ?? "",
            audience: options.audience?.trim() ?? "",
            mode: options.mode ?? null,
          },
          themePackageId: request?.themePackageId ?? null,
        });
        const nextOperationIdempotency =
          request?.idempotencyKey?.trim() &&
          request.idempotencyKey.trim().length > 0
            ? {
                fingerprint: operationFingerprint,
                key: request.idempotencyKey.trim(),
              }
            : operationIdempotencyRef.current?.fingerprint ===
                operationFingerprint
              ? operationIdempotencyRef.current
              : {
                  fingerprint: operationFingerprint,
                  key: createOperationIdempotencyKey("deck-generate"),
                };
        operationIdempotencyRef.current = nextOperationIdempotency;
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
          {
            themePackageId: request?.themePackageId,
            idempotencyKey: nextOperationIdempotency.key,
          },
        );

        // A newer request, reset, or unmount made this result stale.
        const cancelKind = cancelReasonRef.current.get(controller);
        if (cancelKind) {
          cancelReasonRef.current.delete(controller);
          return { ok: false, canceled: true, cancelKind };
        }
        if (!mountedRef.current || abortRef.current !== controller) {
          return {
            ok: false,
            canceled: true,
            cancelKind: abortRef.current ? "superseded" : "canceled",
          };
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
        } else if (result.canceled) {
          setStatus("idle");
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
      };

      const promise = execute().finally(() => {
        if (activeGenerationRef.current?.token === token) {
          activeGenerationRef.current = null;
          activationLockRef.current = false;
        }
      });
      activeGenerationRef.current = { token, promise };
      return promise;
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
