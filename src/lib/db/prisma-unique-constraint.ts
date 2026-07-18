import { Prisma } from "@/generated/prisma/client";

type UniqueConstraintIdentity = {
  fields: readonly string[];
  constraintName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function matchesFields(
  targetFields: readonly string[],
  expectedFields: readonly string[],
): boolean {
  if (targetFields.length !== expectedFields.length) return false;
  const normalized = targetFields.map((field) => field.trim());
  return expectedFields.every((field) => normalized.includes(field));
}

function matchesStringTarget(
  target: string,
  identity: UniqueConstraintIdentity,
): boolean {
  const normalizedTarget = target.replace(/["'`()[\]]/g, "").trim();
  if (
    normalizedTarget === identity.constraintName ||
    normalizedTarget.endsWith(`.${identity.constraintName}`)
  ) {
    return true;
  }

  return matchesFields(
    normalizedTarget
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    identity.fields,
  );
}

function extractConstraintTarget(
  error: Prisma.PrismaClientKnownRequestError,
): string | string[] | null {
  const meta = error.meta;
  if (!isRecord(meta)) return null;

  if (typeof meta.target === "string" || isStringArray(meta.target)) {
    return meta.target;
  }

  const driverAdapterError = meta.driverAdapterError;
  if (!isRecord(driverAdapterError)) return null;
  const cause = driverAdapterError.cause;
  if (!isRecord(cause)) return null;
  const constraint = cause.constraint;
  if (!isRecord(constraint)) return null;

  if (isStringArray(constraint.fields)) return constraint.fields;
  if (typeof constraint.name === "string") return constraint.name;
  if (typeof constraint.index === "string") return constraint.index;
  return null;
}

export function isPrismaUniqueConstraintConflict(
  error: unknown,
  identity: UniqueConstraintIdentity,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = extractConstraintTarget(error);
  if (!target) return false;
  return typeof target === "string"
    ? matchesStringTarget(target, identity)
    : matchesFields(target, identity.fields);
}
