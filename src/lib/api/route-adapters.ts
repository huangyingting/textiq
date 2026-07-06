import { NextResponse } from "next/server";

import { validationError } from "@/lib/api/errors";

export interface JsonObjectRequest {
  json(): Promise<unknown>;
  text?(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
  headers?: Headers;
}

export interface FormDataRequest {
  formData(): Promise<FormData>;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}

interface BodySizeOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

type BodyReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

const utf8Encoder = new TextEncoder();

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

function byteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function tooLargeResponse(options: BodySizeOptions): NextResponse {
  return validationError(
    options.tooLargeMessage ?? "Request body is too large.",
    413,
  );
}

type BodySizeOptionsWithLimit = Required<Pick<BodySizeOptions, "maxBytes">> &
  BodySizeOptions;

async function readBytesWithLimit(
  request: { headers?: Headers; body?: ReadableStream<Uint8Array> | null },
  options: BodySizeOptionsWithLimit,
): Promise<BodyReadResult<Uint8Array[]>> {
  const preflight = rejectOversizedBody(
    request,
    options.maxBytes,
    options.tooLargeMessage,
  );
  if (preflight) return { ok: false, response: preflight };

  if (!request.body) {
    return { ok: true, value: [] };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: tooLargeResponse(options) };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, value: chunks };
}

async function readTextWithLimit(
  request: JsonObjectRequest,
  options: BodySizeOptionsWithLimit,
): Promise<BodyReadResult<string>> {
  const preflight = rejectOversizedBody(
    request,
    options.maxBytes,
    options.tooLargeMessage,
  );
  if (preflight) return { ok: false, response: preflight };

  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        return { ok: false, response: tooLargeResponse(options) };
      }
      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return { ok: true, value: text };
  }

  if (request.text) {
    const text = await request.text();
    if (byteLength(text) > options.maxBytes) {
      return { ok: false, response: tooLargeResponse(options) };
    }
    return { ok: true, value: text };
  }

  return {
    ok: false,
    response: validationError("Request body must be valid JSON."),
  };
}

async function readJsonBody(
  request: JsonObjectRequest,
  options: BodySizeOptions,
  createInvalidResponse: () => NextResponse,
): Promise<BodyReadResult<unknown>> {
  if (options.maxBytes !== undefined) {
    let text: BodyReadResult<string>;
    try {
      text = await readTextWithLimit(request, {
        ...options,
        maxBytes: options.maxBytes,
      });
    } catch {
      return { ok: false, response: createInvalidResponse() };
    }
    if (!text.ok) return text;

    try {
      return { ok: true, value: JSON.parse(text.value) };
    } catch {
      return { ok: false, response: createInvalidResponse() };
    }
  }

  return readBody(
    request,
    options,
    () => request.json(),
    createInvalidResponse,
  );
}

function formDataPayloadBytes(formData: FormData): number {
  let totalBytes = 0;
  for (const [, value] of formData) {
    totalBytes +=
      typeof value === "string" ? byteLength(value) : Math.max(0, value.size);
  }
  return totalBytes;
}

function multipartParseHeaders(request: FormDataRequest): Headers {
  const headers = new Headers();
  const contentType = request.headers?.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

async function parseBoundedFormData(
  request: FormDataRequest,
  chunks: Uint8Array[],
): Promise<FormData> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: multipartParseHeaders(request),
  }).formData();
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
  const parsed = await readJsonBody(request, options, () =>
    validationError("Request body must be valid JSON."),
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
  const parsed = await readJsonBody(request, options, () =>
    validationError(invalidMessage),
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
  const maxBytes = options.maxBytes;
  const parsed =
    maxBytes === undefined || !request.body
      ? await readBody(
          request,
          options,
          () => request.formData(),
          () => createErrorResponse(invalidMessage),
        )
      : await (async (): Promise<BodyReadResult<FormData>> => {
          let body: BodyReadResult<Uint8Array[]>;
          try {
            body = await readBytesWithLimit(request, {
              ...options,
              maxBytes,
            });
          } catch {
            return { ok: false, response: createErrorResponse(invalidMessage) };
          }
          if (!body.ok) return body;

          try {
            return {
              ok: true,
              value: await parseBoundedFormData(request, body.value),
            };
          } catch {
            return { ok: false, response: createErrorResponse(invalidMessage) };
          }
        })();
  if (!parsed.ok) return parsed;
  if (
    options.maxBytes !== undefined &&
    formDataPayloadBytes(parsed.value) > options.maxBytes
  ) {
    return { ok: false, response: tooLargeResponse(options) };
  }
  return { ok: true, formData: parsed.value };
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
