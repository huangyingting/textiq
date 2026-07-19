/**
 * Framework-free password rules and bcrypt helpers shared by auth flows.
 *
 * Keeping validation and hashing here (no Prisma, no Next.js, no React) gives
 * signup, sign-in, reset-password, and settings one source of truth for password
 * length, bcrypt cost, and comparison behavior.
 */

import bcrypt from "bcryptjs";

/** Minimum number of characters required for a stored password. */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt cost factor used for every credentials password hash. */
export const PASSWORD_HASH_COST = 12;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* node:coverage ignore start -- Password validation result variants are TypeScript-only facade rows. */
export type PasswordValidationResult =
  { ok: true } | { ok: false; message: string };
/* node:coverage ignore stop */

/**
 * Validates a new password and its confirmation for the change/set-password
 * flow. Rejects passwords that are too short or that don't match their
 * confirmation; the messages are safe to surface directly (they describe the
 * caller's own input and leak nothing about the account).
 *
 * It deliberately does NOT verify the current password; credential services do
 * that with the stored hash and centralized bcrypt compare helper.
 */
export function validatePasswordChange(input: {
  newPassword: string;
  confirmPassword: string;
}): PasswordValidationResult {
  const { newPassword, confirmPassword } = input;

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (newPassword !== confirmPassword) {
    return { ok: false, message: "New passwords don't match." };
  }

  return { ok: true };
}

export function normalizeEmail(
  value: FormDataEntryValue | string | null,
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function validateEmail(email: string): PasswordValidationResult {
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return { ok: true };
}

export function validatePasswordLength(
  password: string,
): PasswordValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

export async function comparePassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
