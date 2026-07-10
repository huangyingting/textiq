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
  if (
    typeof env.timestamp !== "string" ||
    Number.isNaN(Date.parse(env.timestamp))
  ) {
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
