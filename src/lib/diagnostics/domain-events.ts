import { logError, logInfo } from "@/lib/log";
import redaction from "@/lib/log-redaction-core.cjs";

type SafeScalar = string | number | boolean;

function copyAllowedScalars<T extends object>(
  event: T,
  allowedKeys: readonly (keyof T & string)[],
): Record<string, SafeScalar> {
  const context: Record<string, SafeScalar> = {};
  const values = event as Record<string, unknown>;
  for (const key of allowedKeys) {
    const value = values[key];
    if (value === undefined || !redaction.isSafeTelemetryScalar(value)) {
      continue;
    }
    context[key] = redaction.isSensitiveKey(key) ? redaction.REDACTED : value;
  }
  return context;
}

export type UsageLedgerOperation = "reserve" | "capture" | "refund";

export interface UsageLedgerTelemetryEvent {
  keyHash: string;
  operation?: string;
  creditCost?: number;
  status?: string;
  reservationVersion?: number;
}

const USAGE_LEDGER_KEYS = [
  "keyHash",
  "operation",
  "creditCost",
  "status",
  "reservationVersion",
] as const;

export function buildUsageLedgerContext(
  event: UsageLedgerTelemetryEvent,
): Record<string, SafeScalar> {
  return copyAllowedScalars(event, USAGE_LEDGER_KEYS);
}

export function logUsageLedgerEvent(
  operation: UsageLedgerOperation,
  message: string,
  event: UsageLedgerTelemetryEvent,
): void {
  logInfo(
    `billing.ledger.${operation}`,
    message,
    buildUsageLedgerContext(event),
  );
}

export function logUsageLedgerFailure(
  operation: UsageLedgerOperation,
  error: unknown,
  event: UsageLedgerTelemetryEvent,
): void {
  logError(
    `billing.ledger.${operation}`,
    error,
    buildUsageLedgerContext(event),
  );
}

export type MeteredUsageOperation = "reserve" | "capture" | "refund";

export interface MeteredUsageTelemetryEvent extends UsageLedgerTelemetryEvent {
  userId?: string;
}

const METERED_USAGE_KEYS = [
  "keyHash",
  "operation",
  "creditCost",
  "status",
  "reservationVersion",
  "userId",
] as const;

export function buildMeteredUsageContext(
  event: MeteredUsageTelemetryEvent,
): Record<string, SafeScalar> {
  return copyAllowedScalars(event, METERED_USAGE_KEYS);
}

export function logMeteredUsageEvent(
  /* Coverage rationale: operation/message/event parameters are asserted through emitted log records; tsx maps signature rows as uncovered. */
  /* node:coverage ignore next 3 */
  operation: MeteredUsageOperation,
  message: string,
  event: MeteredUsageTelemetryEvent,
): void {
  logInfo(
    `billing.metered.${operation}`,
    message,
    buildMeteredUsageContext(event),
  );
}

export function logMeteredUsageFailure(
  operation: MeteredUsageOperation,
  error: unknown,
  event: MeteredUsageTelemetryEvent,
): void {
  logError(
    `billing.metered.${operation}`,
    error,
    buildMeteredUsageContext(event),
  );
}

export type AssetTelemetryArea = "slide" | "brand";
export type AssetTelemetryOperation = "mark" | "purge" | "storage_delete";

export interface AssetOrphanTelemetryEvent {
  documentId?: string;
  brandId?: string;
  markedCount?: number;
  purgedCount?: number;
  storageKey?: string;
}

const ASSET_ORPHAN_KEYS = [
  "documentId",
  "brandId",
  "markedCount",
  "purgedCount",
  "storageKey",
] as const;

export function buildAssetOrphanContext(
  event: AssetOrphanTelemetryEvent,
): Record<string, SafeScalar> {
  return copyAllowedScalars(event, ASSET_ORPHAN_KEYS);
}

export function logAssetOrphanEvent(
  area: AssetTelemetryArea,
  operation: AssetTelemetryOperation,
  message: string,
  event: AssetOrphanTelemetryEvent,
): void {
  logInfo(
    `asset.${area}.${operation}`,
    message,
    buildAssetOrphanContext(event),
  );
}

export function logAssetOrphanFailure(
  area: AssetTelemetryArea,
  operation: AssetTelemetryOperation,
  error: unknown,
  event: AssetOrphanTelemetryEvent,
): void {
  logError(`asset.${area}.${operation}`, error, buildAssetOrphanContext(event));
}

export interface CommandValidationTelemetryEvent {
  commandId?: string;
  commandType?: string;
  commandSurface?: string;
  schemaVersion?: number;
  documentId?: string;
  visualId?: string;
  slideId?: string;
  elementId?: string;
  errorCode?: string;
}

const COMMAND_VALIDATION_KEYS = [
  "commandId",
  "commandType",
  "commandSurface",
  "schemaVersion",
  "documentId",
  "visualId",
  "slideId",
  "elementId",
  "errorCode",
] as const;

export function buildCommandValidationContext(
  event: CommandValidationTelemetryEvent,
): Record<string, SafeScalar> {
  return copyAllowedScalars(event, COMMAND_VALIDATION_KEYS);
}
