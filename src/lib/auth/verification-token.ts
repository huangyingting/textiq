/**
 * Pure, framework-free helpers for the email-verification flow (#162).
 *
 * Everything here is I/O-free (no Prisma, no Next.js, no
 * React) so it can be unit-tested under `node --test` + `tsx` and kept as the
 * single source of truth for:
 *
 *  - how a raw verification token is generated (`generateVerificationToken`),
 *  - how it is hashed for storage (`hashVerificationToken` — only the hash is
 *    ever persisted, so a database leak cannot be replayed),
 *  - how long a token lives (`VERIFICATION_TOKEN_TTL_MS`), and
 *  - whether a looked-up token may be used right now
 *    (`evaluateVerificationToken`).
 *
 * The server action / route does the database reads/writes; this module decides.
 * It deliberately mirrors `reset-token.ts` so both flows share the same proven,
 * hash-only, single-use, time-boxed token shape.
 */

import {
  evaluateSingleUseToken,
  generateSingleUseToken,
  hashSingleUseToken,
  type SingleUseTokenEvaluation,
  type SingleUseTokenRejection,
} from "@/lib/auth/single-use-token";

/** How long a verification token stays valid after it is issued (24 hours). */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Generates a cryptographically-random, URL-safe verification token. The raw
 * value is emailed to the user and never stored; only its
 * {@link hashVerificationToken} digest is persisted.
 */
export function generateVerificationToken(): string {
  return generateSingleUseToken();
}

export type VerificationTokenMaterial = Readonly<{
  rawToken: string;
  tokenHash: string;
}>;

/**
 * Hashes a raw verification token with SHA-256 (hex) for storage and lookup. A
 * plain unsalted hash is appropriate here — the token is high-entropy random, so
 * it is not subject to dictionary/brute-force attacks the way a password would
 * be, and a deterministic digest lets us look the row up by `tokenHash`.
 */
export function hashVerificationToken(rawToken: string): string {
  return hashSingleUseToken(rawToken);
}

export function generateVerificationTokenMaterial(): VerificationTokenMaterial {
  const rawToken = generateVerificationToken();
  return {
    rawToken,
    tokenHash: hashVerificationToken(rawToken),
  };
}

export type VerificationTokenPersistenceInput = Readonly<{
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}>;

export function buildVerificationTokenPersistenceInput(input: {
  userId: string;
  material: VerificationTokenMaterial;
  expiresAt: Date;
}): VerificationTokenPersistenceInput {
  return {
    userId: input.userId,
    tokenHash: input.material.tokenHash,
    expiresAt: input.expiresAt,
  };
}

/* @preserve node:coverage ignore next 6 -- Verification-token aliases are TypeScript-only facade exports. */
/** Why a token can't be used, when {@link evaluateVerificationToken} rejects. */
export type VerificationTokenRejection = SingleUseTokenRejection;

export type VerificationTokenEvaluation = SingleUseTokenEvaluation;
/* node:coverage ignore next 7 -- Verification-token evaluator documentation is a source-map-only row; behavior is asserted. */
/**
 * Decides whether a verification token may be used *now*, given the facts about
 * the looked-up row. A token is valid only when it exists, has not already been
 * consumed (`usedAt` is null), and has not expired (`now < expiresAt`). Order
 * matters: a missing row is reported before anything else, and a token that is
 * both used and expired reports `used` (it was already spent).
 *
 * Pure and DOM-free so the decision can be asserted exactly in unit tests.
 */
export function evaluateVerificationToken(input: {
  exists: boolean;
  expiresAt: Date | null;
  usedAt: Date | null;
  now: Date;
}): VerificationTokenEvaluation {
  return evaluateSingleUseToken(input);
}

/** User-facing copy for each rejection reason (safe to surface directly). */
export const VERIFICATION_TOKEN_REJECTION_MESSAGE: Record<
  VerificationTokenRejection,
  string
> = {
  not_found:
    "This verification link is invalid. Request a new one from settings.",
  used: "This email has already been verified.",
  expired:
    "This verification link has expired. Request a new one from settings.",
};
