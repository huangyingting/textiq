import crypto from "node:crypto";

/** Number of random bytes behind each raw token (256 bits of entropy). */
const TOKEN_BYTES = 32;

/* @preserve node:coverage ignore start -- Single-use token result contracts are TypeScript-only. */
export type SingleUseTokenRejection = "not_found" | "used" | "expired";

export type SingleUseTokenEvaluation =
  { valid: true } | { valid: false; reason: SingleUseTokenRejection };

export type SingleUseTokenRejectionMessages = Record<
  SingleUseTokenRejection,
  string
>;
/* @preserve node:coverage ignore stop */

/** Generates a cryptographically-random, URL-safe raw token. */
export function generateSingleUseToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hashes a high-entropy raw token with SHA-256 (hex) for storage and lookup. */
export function hashSingleUseToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Computes the absolute expiration time for a token issued at `now`. */
export function singleUseTokenExpiresAt(
  ttlMs: number,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + ttlMs);
}

/** Evaluates existence, single-use, and TTL constraints shared by auth tokens. */
export function evaluateSingleUseToken(input: {
  exists: boolean;
  expiresAt: Date | null;
  usedAt: Date | null;
  now: Date;
}): SingleUseTokenEvaluation {
  const { exists, expiresAt, usedAt, now } = input;

  if (!exists || expiresAt === null) {
    return { valid: false, reason: "not_found" };
  }

  if (usedAt !== null) {
    return { valid: false, reason: "used" };
  }

  if (now.getTime() >= expiresAt.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true };
}
