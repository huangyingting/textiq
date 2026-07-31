import { createHmac, timingSafeEqual } from "node:crypto";

import { comparePassword, hashPassword } from "@/lib/auth/password";
import {
  normalizeSharePasscode,
  validateSharePasscode,
} from "@/lib/share-passcode-policy";

export {
  MAX_SHARE_PASSCODE_LENGTH,
  MIN_SHARE_PASSCODE_LENGTH,
  normalizeSharePasscode,
  validateSharePasscode,
} from "@/lib/share-passcode-policy";
export const SHARE_PASSCODE_UNLOCK_MAX_AGE_SECONDS = 12 * 60 * 60;

const COOKIE_PREFIX = "textiq_share_unlock_";
const TOKEN_VERSION = "v1";

export async function hashSharePasscode(passcode: string): Promise<string> {
  const normalized = normalizeSharePasscode(passcode);
  const validation = validateSharePasscode(normalized);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return hashPassword(normalized);
}

export async function verifySharePasscode(
  passcode: string,
  passcodeHash: string | null | undefined,
): Promise<boolean> {
  if (!passcodeHash) return false;
  const normalized = normalizeSharePasscode(passcode);
  if (!normalized) return false;
  return comparePassword(normalized, passcodeHash);
}

export function sharePasscodeCookieName(shareId: string): string {
  const safeShareId = shareId.replace(/[^A-Za-z0-9_-]/g, "");
  return `${COOKIE_PREFIX}${safeShareId}`;
}

function signUnlockToken(input: {
  shareId: string;
  passcodeHash: string;
  expiresAt: number;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.shareId}.${input.passcodeHash}.${input.expiresAt}`)
    .digest("hex");
}

export function createSharePasscodeUnlockToken(input: {
  shareId: string;
  passcodeHash: string;
  secret: string;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const expiresAt = now + SHARE_PASSCODE_UNLOCK_MAX_AGE_SECONDS * 1000;
  const signature = signUnlockToken({ ...input, expiresAt });
  return `${TOKEN_VERSION}.${expiresAt}.${signature}`;
}

export function safeReturnPath(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "");
  if (
    raw.startsWith("/share/") ||
    raw.startsWith("/embed/") ||
    raw.startsWith("/present/")
  ) {
    return raw;
  }
  return "/share";
}

export function isSharePasscodeUnlockTokenValid(input: {
  token: string | null | undefined;
  shareId: string;
  passcodeHash: string | null | undefined;
  secret: string | undefined;
  now?: number;
}): boolean {
  if (!input.passcodeHash) return true;
  if (!input.token || !input.secret) return false;

  const [version, expiresAtRaw, signature] = input.token.split(".");
  if (version !== TOKEN_VERSION || !expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= (input.now ?? Date.now())) {
    return false;
  }

  const expected = signUnlockToken({
    shareId: input.shareId,
    passcodeHash: input.passcodeHash,
    expiresAt,
    secret: input.secret,
  });

  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
