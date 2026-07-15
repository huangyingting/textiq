export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function randomToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  return `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

function normalizeOperation(operation: string): string {
  const normalized = operation
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return normalized.length > 0 ? normalized.slice(0, 24) : "op";
}

export function isValidIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function createOperationIdempotencyKey(operation: string): string {
  const key = `${normalizeOperation(operation)}-${Date.now().toString(36)}-${randomToken().slice(0, 24)}`;

  if (!isValidIdempotencyKey(key)) {
    throw new Error(
      "Generated idempotency key does not satisfy route contract.",
    );
  }

  return key;
}

export function resolveOperationIdempotencyKey(
  operation: string,
  provided?: string,
): string {
  const candidate =
    provided?.trim() || createOperationIdempotencyKey(operation);

  if (!isValidIdempotencyKey(candidate)) {
    throw new Error(
      "`Idempotency-Key` must be 8-128 chars and use only letters, numbers, dot (.), underscore (_), colon (:), or hyphen (-).",
    );
  }

  return candidate;
}
