import { NextResponse } from "next/server";

import { validationError } from "@/lib/api/errors";

export interface JsonObjectRequest {
  json(): Promise<unknown>;
  headers?: Headers;
}

export interface FormDataRequest {
  formData(): Promise<FormData>;
  headers?: Headers;
}

interface BodySizeOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

type BodyReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestContentLength(request: { headers?: Headers }): number | null {
  const raw = request.headers?.get("content-length")?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function rejectOversizedBody(
  request: { headers?: Headers },
  maxBytes: number,
  message = "Request body is too large.",
): NextResponse | null {
  const contentLength = requestContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    return validationError(message, 413);
  }
  return null;
}

async function readBody<T>(
  request: { headers?: Headers },
  options: BodySizeOptions,
  parse: () => Promise<T>,
  createInvalidResponse: () => NextResponse,
): Promise<BodyReadResult<T>> {
  if (options.maxBytes !== undefined) {
    const tooLarge = rejectOversizedBody(
      request,
      options.maxBytes,
      options.tooLargeMessage,
    );
    if (tooLarge) return { ok: false, response: tooLarge };
  }
  try {
    return { ok: true, value: await parse() };
  } catch {
    return { ok: false, response: createInvalidResponse() };
  }
}

export async function readJsonObject(
  request: JsonObjectRequest,
  options: BodySizeOptions = {},
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const parsed = await readBody(
    request,
    options,
    () => request.json(),
    () => validationError("Request body must be valid JSON."),
  );
  if (!parsed.ok) return parsed;
  const body = parsed.value;
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: validationError("Request body must be a JSON object."),
    };
  }
  return { ok: true, body };
}

export async function readJsonValue(
  request: JsonObjectRequest,
  invalidMessage = "Request body must be valid JSON.",
  options: BodySizeOptions = {},
): Promise<
  { ok: true; body: unknown } | { ok: false; response: NextResponse }
> {
  const parsed = await readBody(
    request,
    options,
    () => request.json(),
    () => validationError(invalidMessage),
  );
  return parsed.ok ? { ok: true, body: parsed.value } : parsed;
}

export async function readFormData(
  request: FormDataRequest,
  invalidMessage = "Request must be multipart/form-data.",
  createErrorResponse: (message: string) => NextResponse = (message) =>
    validationError(message),
  options: BodySizeOptions = {},
): Promise<
  /* node:coverage ignore next -- Return union is a type-only signature artifact; form-data outcomes are asserted. */
  { ok: true; formData: FormData } | { ok: false; response: NextResponse }
> {
  const parsed = await readBody(
    request,
    options,
    () => request.formData(),
    () => createErrorResponse(invalidMessage),
  );
  return parsed.ok ? { ok: true, formData: parsed.value } : parsed;
}

export function requiredSearchParam(
  url: string | URL,
  name: string,
): string | null {
  const value = new URL(url).searchParams.get(name)?.trim();
  return value ? value : null;
}

export function retryAfterHeader(retryAfterSeconds: number): HeadersInit {
  return { "Retry-After": String(retryAfterSeconds) };
}

export function privateImmutableCacheHeaders(
  contentType: string,
): Record<string, string> {
  /*! node:coverage ignore next 5 -- Header object values are asserted; tsx maps the object literal as uncovered. */
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}

export function plainTextResponse(body: string, status: number): NextResponse {
  /*! node:coverage ignore next 3 -- Plain-text response body/status are asserted; tsx maps this constructor call as uncovered. */
  return new NextResponse(body, { status });
}
