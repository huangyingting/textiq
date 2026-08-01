/** Minimum number of characters required for an account password. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Maximum UTF-8 byte length bcrypt can distinguish without truncation.
 *
 * HTML `maxLength` counts UTF-16 code units rather than UTF-8 bytes, so the
 * server must still enforce this limit for multibyte input.
 */
export const MAX_PASSWORD_UTF8_BYTES = 72;

/** Early browser-side character cap; byte validation remains authoritative. */
export const PASSWORD_INPUT_MAX_LENGTH = MAX_PASSWORD_UTF8_BYTES;

export function passwordUtf8ByteLength(password: string): number {
  return new TextEncoder().encode(password).byteLength;
}

export function passwordExceedsBcryptLimit(password: string): boolean {
  return passwordUtf8ByteLength(password) > MAX_PASSWORD_UTF8_BYTES;
}
