export const MIN_SHARE_PASSCODE_LENGTH = 4;
export const MAX_SHARE_PASSCODE_LENGTH = 128;

export function normalizeSharePasscode(value: unknown): string {
  return String(value ?? "").trim();
}

export function validateSharePasscode(
  passcode: string,
): { ok: true } | { ok: false; message: string } {
  if (passcode.length < MIN_SHARE_PASSCODE_LENGTH) {
    return {
      ok: false,
      message: `Passcode must be at least ${MIN_SHARE_PASSCODE_LENGTH} characters.`,
    };
  }
  if (passcode.length > MAX_SHARE_PASSCODE_LENGTH) {
    return {
      ok: false,
      message: `Passcode must be at most ${MAX_SHARE_PASSCODE_LENGTH} characters.`,
    };
  }
  return { ok: true };
}
