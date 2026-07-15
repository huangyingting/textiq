import redaction from "@/lib/log-redaction-core.cjs";
import type { ImportRouteError } from "@/lib/import/contract";
import { telemetryFileTypeForImport } from "@/lib/import/format-registry";

export type SafeTelemetryValue = string | number | boolean;

export const PRODUCT_EVENT_DEFINITIONS = {
  "product.onboarding.activation": [
    "activationKind",
    "completedStepCount",
    "stepCount",
  ],
  "product.onboarding.dismissed": ["completedStepCount", "stepCount"],
  "product.import.started": ["fileSizeBucket", "fileType", "surface"],
  "product.import.succeeded": [
    "durationBucket",
    "fileSizeBucket",
    "fileType",
    "surface",
  ],
  "product.import.failed": [
    "durationBucket",
    "failureReason",
    "fileSizeBucket",
    "fileType",
    "status",
    "surface",
  ],
  "product.export.started": ["exportKind", "outputFormat"],
  "product.export.succeeded": [
    "durationBucket",
    "exportKind",
    "fileSizeBucket",
    "outputFormat",
  ],
  "product.export.failed": [
    "durationBucket",
    "exportKind",
    "failureReason",
    "outputFormat",
    "status",
  ],
  "product.ai.visual.started": [
    "detailLevel",
    "inputSizeBucket",
    "orientation",
    "sourceKind",
    "visualKind",
  ],
  "product.ai.visual.candidates": [
    "candidateCount",
    "durationBucket",
    "inputSizeBucket",
    "sourceKind",
    "visualKind",
  ],
  "product.ai.visual.failed": [
    "durationBucket",
    "failureReason",
    "inputSizeBucket",
    "sourceKind",
    "status",
    "visualKind",
  ],
  "product.ai.visual.applied": ["sourceKind", "visualKind"],
  "product.ai.deck.started": ["inputSizeBucket", "optionLength", "sourceKind"],
  "product.ai.deck.candidate": [
    "durationBucket",
    "inputSizeBucket",
    "optionLength",
    "slideCount",
    "truncated",
  ],
  "product.ai.deck.failed": [
    "durationBucket",
    "failureReason",
    "inputSizeBucket",
    "optionLength",
    "status",
  ],
  "product.ai.deck.applied": ["editDistanceBucket", "slideCount", "truncated"],
  "product.ai.deck.saved": ["editDistanceBucket", "slideCount"],
  "product.editor.command.succeeded": [
    "commandName",
    "durationBucket",
    "elementCountBucket",
    "slideCount",
    "surface",
  ],
  "product.editor.command.failed": [
    "commandName",
    "durationBucket",
    "failureReason",
    "status",
    "surface",
  ],
  "product.editor.undo": ["slideCount", "surface"],
  "product.editor.redo": ["slideCount", "surface"],
  "product.editor.load.timing": [
    "durationBucket",
    "slideCount",
    "surface",
    "visualCountBucket",
  ],
  "product.editor.render.timing": [
    "durationBucket",
    "elementCountBucket",
    "slideCount",
    "surface",
  ],
  "product.editor.error.visible": ["errorCode", "surface"],
} as const;

export type ProductEventName = keyof typeof PRODUCT_EVENT_DEFINITIONS;
export type ProductEventField<TName extends ProductEventName> =
  (typeof PRODUCT_EVENT_DEFINITIONS)[TName][number];
export type ProductTelemetryFields<TName extends ProductEventName> = Partial<
  Record<ProductEventField<TName>, SafeTelemetryValue | undefined>
>;

export interface ProductTelemetryRecord {
  eventName: ProductEventName;
  timestamp: string;
  fields: Record<string, SafeTelemetryValue>;
}

export type ProductTelemetrySink = (
  event: ProductTelemetryRecord,
) => void | Promise<void>;

let sink: ProductTelemetrySink | null = null;

export function configureProductTelemetrySink(
  nextSink: ProductTelemetrySink | null,
): () => void {
  const previous = sink;
  sink = nextSink;
  return () => {
    sink = previous;
  };
}

export function buildProductTelemetryEvent<TName extends ProductEventName>(
  eventName: TName,
  fields: ProductTelemetryFields<TName> = {},
  now: Date = new Date(),
): ProductTelemetryRecord {
  const allowed = new Set<string>(PRODUCT_EVENT_DEFINITIONS[eventName]);
  const safeFields: Record<string, SafeTelemetryValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key) || value === undefined) {
      continue;
    }
    if (
      redaction.isContentKey(key) ||
      !redaction.isSafeTelemetryScalar(value)
    ) {
      continue;
    }
    safeFields[key] = redaction.isSensitiveKey(key)
      ? redaction.REDACTED
      : value;
  }
  return {
    eventName,
    timestamp: now.toISOString(),
    fields: safeFields,
  };
}

export function emitProductTelemetry<TName extends ProductEventName>(
  eventName: TName,
  fields: ProductTelemetryFields<TName> = {},
): void {
  try {
    const currentSink = sink;
    if (!currentSink) {
      return;
    }
    void currentSink(buildProductTelemetryEvent(eventName, fields));
  } catch {
    // Telemetry must never affect product behavior.
  }
}

export function bucketDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 100) return "lt100ms";
  if (ms < 500) return "100ms-500ms";
  if (ms < 1_000) return "500ms-1s";
  if (ms < 3_000) return "1s-3s";
  if (ms < 10_000) return "3s-10s";
  if (ms < 30_000) return "10s-30s";
  return "gte30s";
}

export function bucketBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes === 0) return "zero";
  if (bytes < 10 * 1024) return "lt10kb";
  if (bytes < 100 * 1024) return "10kb-100kb";
  if (bytes < 1024 * 1024) return "100kb-1mb";
  if (bytes < 5 * 1024 * 1024) return "1mb-5mb";
  if (bytes < 20 * 1024 * 1024) return "5mb-20mb";
  return "gte20mb";
}

export function bucketCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "unknown";
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2-5";
  if (count <= 10) return "6-10";
  if (count <= 25) return "11-25";
  if (count <= 50) return "26-50";
  return "gt50";
}

export function reasonFromStatus(status: number | undefined): string {
  if (status === undefined) return "unknown";
  if (status === 400) return "validation";
  if (status === 402) return "quota";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}

export function reasonFromImportError(error: ImportRouteError): string {
  switch (error.code) {
    case "unsupported":
      return "unsupported";
    case "too_large":
      return "too_large";
    case "malformed":
      return "malformed";
    case "encrypted":
      return "encrypted";
    case "archive_limits":
      return "archive_limits";
    case "timeout":
      return "timeout";
    case "aborted":
      return "aborted";
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "persistence":
      return "persistence";
    case "conflict":
      return "conflict";
    case "internal":
      return "internal";
  }
}

export function classifyFileType(file: Pick<File, "name" | "type">): string {
  return telemetryFileTypeForImport(file);
}
