import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from "@/lib/type-guards";

export const CURRENT_COMMAND_SCHEMA_VERSION = 1 as const;

const COMMAND_SOURCES = ["user", "ai", "sync", "replay"] as const;
const COMMAND_SURFACES = [
  "document",
  "visual",
  "deck",
  "asset",
  "comment",
  "source-ref",
] as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

export type CommandSource = (typeof COMMAND_SOURCES)[number];
export type CommandTargetSurface = (typeof COMMAND_SURFACES)[number];

export interface CommandActor {
  id: string;
  /*! node:coverage ignore next -- Type-only optional field is erased by TypeScript; source maps can still attribute uncovered rows here. */
  sessionId?: string;
}

export interface CommandTarget {
  surface: CommandTargetSurface;
  documentId?: string;
  visualId?: string;
  slideId?: string;
  elementId?: string;
  assetId?: string;
  commentId?: string;
  sourceRefId?: string;
  expectedRevision?: string;
  expectedSourceHash?: string;
}

export interface CommandEnvelope<P = unknown> {
  id: string;
  schemaVersion: number;
  type: string;
  timestamp: string;
  actor: CommandActor;
  target: CommandTarget;
  payload: P;
  coalesceKey?: string;
  source?: CommandSource;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isOneOf<T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return typeof value === "string" && options.includes(value as T[number]);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isIso8601Timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_8601_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zoneText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (zoneText !== "Z") {
    const zoneHour = Number(zoneText.slice(1, 3));
    const zoneMinute = Number(zoneText.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

export function uniqueStrings(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    if (!isNonEmptyString(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function pushUnknownKeyErrors(
  input: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      errors.push(`${context}.${key} is not supported.`);
    }
  }
}

function findNonJsonPayloadReason(
  value: unknown,
  path = "payload",
  seen: WeakSet<object> = new WeakSet(),
): string | undefined {
  if (value === null) {
    return undefined;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return undefined;
    case "number":
      return Number.isFinite(value)
        ? undefined
        : `${path} must be a finite number.`;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return `${path} contains non-JSON value ${typeof value}.`;
    case "object":
      break;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return `${path} contains a cycle.`;
  }

  seen.add(objectValue);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const reason = findNonJsonPayloadReason(
        value[index],
        `${path}[${index}]`,
        seen,
      );
      if (reason) {
        return reason;
      }
    }
    seen.delete(objectValue);
    return undefined;
  }

  if (!isPlainObject(value)) {
    seen.delete(objectValue);
    return `${path} must contain only JSON objects, arrays, and primitives.`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(objectValue);
    return `${path} must contain only plain JSON objects.`;
  }

  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    seen.delete(objectValue);
    return `${path} contains non-JSON symbol keys.`;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    const reason = findNonJsonPayloadReason(entryValue, `${path}.${key}`, seen);
    if (reason) {
      return reason;
    }
  }

  seen.delete(objectValue);
  return undefined;
}

export function validateTarget(target: unknown): {
  surface?: CommandTargetSurface;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isPlainObject(target)) {
    return { errors: ["target must be an object."] };
  }

  pushUnknownKeyErrors(
    target,
    [
      "surface",
      "documentId",
      "visualId",
      "slideId",
      "elementId",
      "assetId",
      "commentId",
      "sourceRefId",
      "expectedRevision",
      "expectedSourceHash",
    ],
    "target",
    errors,
  );

  if (!isOneOf(target.surface, COMMAND_SURFACES)) {
    errors.push(
      `target.surface must be one of: ${COMMAND_SURFACES.join(", ")}.`,
    );
    return { errors };
  }

  for (const key of [
    "documentId",
    "visualId",
    "slideId",
    "elementId",
    "assetId",
    "commentId",
    "sourceRefId",
    "expectedRevision",
    "expectedSourceHash",
  ] as const) {
    const value = target[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      errors.push(`target.${key} must be a non-empty string when provided.`);
    }
  }

  switch (target.surface) {
    case "document":
      if (!isNonEmptyString(target.documentId)) {
        errors.push("target.documentId is required for document commands.");
      }
      break;
    case "visual":
      if (!isNonEmptyString(target.visualId)) {
        errors.push("target.visualId is required for visual commands.");
      }
      break;
    case "deck":
      if (!isNonEmptyString(target.documentId)) {
        errors.push("target.documentId is required for deck commands.");
      }
      break;
    case "asset":
      if (!isNonEmptyString(target.assetId)) {
        errors.push("target.assetId is required for asset commands.");
      }
      break;
    case "comment":
      if (!isNonEmptyString(target.commentId)) {
        errors.push("target.commentId is required for comment commands.");
      }
      break;
    case "source-ref":
      if (!isNonEmptyString(target.sourceRefId)) {
        errors.push("target.sourceRefId is required for source-ref commands.");
      }
      break;
  }

  return { surface: target.surface, errors };
}

export function validateCommandEnvelopeStructure(
  env: CommandEnvelope<unknown>,
): ValidationResult & { surface?: CommandTargetSurface } {
  const errors: string[] = [];
  if (!isPlainObject(env)) {
    return { valid: false, errors: ["Command envelope must be an object."] };
  }

  if (typeof env.id !== "string" || !UUID_V4_PATTERN.test(env.id)) {
    errors.push("id must be a UUID v4 string.");
  }
  if (!Number.isInteger(env.schemaVersion) || env.schemaVersion <= 0) {
    errors.push("schemaVersion must be a positive integer.");
  } else if (env.schemaVersion !== CURRENT_COMMAND_SCHEMA_VERSION) {
    errors.push(`schemaVersion must equal ${CURRENT_COMMAND_SCHEMA_VERSION}.`);
  }
  if (!isNonEmptyString(env.type)) {
    errors.push("type must be a non-empty string.");
  }
  if (!isIso8601Timestamp(env.timestamp)) {
    errors.push("timestamp must be a valid ISO-8601 string.");
  }

  if (!isPlainObject(env.actor)) {
    errors.push("actor must be an object.");
  } else {
    if (!isNonEmptyString(env.actor.id)) {
      errors.push("actor.id must be a non-empty string.");
    }
    /* node:coverage ignore next 5 -- Optional actor session validation is asserted; tsx maps this nested branch as uncovered. */
    const actorSessionId = env.actor.sessionId;
    if (actorSessionId !== undefined && !isNonEmptyString(actorSessionId)) {
      errors.push("actor.sessionId must be a non-empty string when provided.");
    }
  }

  const targetValidation = validateTarget(env.target);
  errors.push(...targetValidation.errors);

  if (env.payload === undefined) {
    errors.push("payload must be present.");
  } else {
    const nonJsonPayloadReason = findNonJsonPayloadReason(env.payload);
    if (nonJsonPayloadReason) {
      errors.push(`payload must be JSON-safe: ${nonJsonPayloadReason}`);
    }
  }

  if (env.coalesceKey !== undefined && !isNonEmptyString(env.coalesceKey)) {
    errors.push("coalesceKey must be a non-empty string when provided.");
  }
  if (env.source !== undefined && !isOneOf(env.source, COMMAND_SOURCES)) {
    errors.push(`source must be one of: ${COMMAND_SOURCES.join(", ")}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    surface: targetValidation.surface,
  };
}
