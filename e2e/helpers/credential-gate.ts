import {
  request,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  assertProfileCredentialGate,
  sendProfileRequestOverVerifiedProxy,
} from "./profile-credential-gate";

export { assertProfileCredentialGate } from "./profile-credential-gate";

type RequestOwner = Page | BrowserContext;
type CredentialGateHooks = {
  afterVerified?: () => Promise<void>;
};
type UnauthenticatedRequestDefaults = {
  baseURL?: string;
  extraHTTPHeaders?: Record<string, string>;
};

export type E2EApiRequest = Pick<
  APIRequestContext,
  "delete" | "fetch" | "get" | "head" | "patch" | "post" | "put"
>;
export type UnauthenticatedE2EApiResponse = Pick<
  APIResponse,
  | "body"
  | "headers"
  | "headersArray"
  | "json"
  | "ok"
  | "status"
  | "statusText"
  | "text"
  | "url"
>;
export type UnauthenticatedE2EApiRequest = {
  get(
    ...args: Parameters<APIRequestContext["get"]>
  ): Promise<UnauthenticatedE2EApiResponse>;
  head(
    ...args: Parameters<APIRequestContext["head"]>
  ): Promise<UnauthenticatedE2EApiResponse>;
};

const SAFE_PUBLIC_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "pragma",
  "range",
  "user-agent",
]);
const CREDENTIAL_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-authorization",
  "x-forwarded-authorization",
  "x-http-authorization",
  "x-original-authorization",
]);
const CREDENTIAL_HEADER_PATTERN =
  /(?:^|[-_])(?:api[-_]?key|auth(?:orization)?|cookie|credential|password|secret|session|token)(?:$|[-_])/i;
let multipartSequence = 0;

/**
 * Returns an API request facade that re-verifies live app/proxy ownership and
 * listener proof immediately before every operation. The Playwright request
 * context is resolved only after the gate succeeds.
 */
export function credentialGatedRequest(
  owner: RequestOwner,
  hooks: CredentialGateHooks = {},
): E2EApiRequest {
  const executeVerified = async (
    operation: "delete" | "fetch" | "get" | "head" | "patch" | "post" | "put",
    args: [string | { url(): string }, { headers?: Record<string, string> }?],
    options: { headers?: Record<string, string> } | undefined,
  ) => {
    await hooks.afterVerified?.();
    const browserContext = "context" in owner ? owner.context() : owner;
    const prepared = prepareVerifiedApiRequest(
      typeof args[0] === "string" ? args[0] : args[0].url(),
      options,
    );
    const method =
      operation === "fetch"
        ? String(
            ((options ?? {}) as Record<string, unknown>).method ?? "GET",
          ).toUpperCase()
        : operation.toUpperCase();
    const cookies = await browserContext.cookies(prepared.url);
    const response = await sendProfileRequestOverVerifiedProxy({
      body: prepared.body,
      headers: {
        ...prepared.headers,
        ...(cookies.length > 0
          ? {
              cookie: cookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join("; "),
            }
          : {}),
      },
      method,
      timeoutMs: prepared.timeoutMs,
      url: prepared.url,
    });
    return snapshotVerifiedResponse(response) as APIResponse;
  };
  return {
    delete: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("delete", args, options);
      const context = owner.request;
      return context.delete(args[0], { ...options, maxRedirects: 0 });
    },
    fetch: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("fetch", args, options);
      const context = owner.request;
      return context.fetch(args[0], { ...options, maxRedirects: 0 });
    },
    get: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("get", args, options);
      const context = owner.request;
      return context.get(args[0], { ...options, maxRedirects: 0 });
    },
    head: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("head", args, options);
      const context = owner.request;
      return context.head(args[0], { ...options, maxRedirects: 0 });
    },
    patch: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("patch", args, options);
      const context = owner.request;
      return context.patch(args[0], { ...options, maxRedirects: 0 });
    },
    post: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("post", args, options);
      const context = owner.request;
      return context.post(args[0], { ...options, maxRedirects: 0 });
    },
    put: async (...args) => {
      await assertProfileCredentialGate();
      const options = sanitizeCredentialGatedOptions(args[1]);
      if (process.env.E2E_PROFILE === "1")
        return executeVerified("put", args, options);
      const context = owner.request;
      return context.put(args[0], { ...options, maxRedirects: 0 });
    },
  };
}

function prepareVerifiedApiRequest(
  rawUrl: string,
  options: { headers?: Record<string, string> } | undefined,
) {
  const source = (options ?? {}) as Record<string, unknown>;
  const url = new URL(rawUrl, configuredE2EOrigin());
  appendSearchParams(url, source.params);
  const headers = { ...(options?.headers ?? {}) };
  let body: Buffer | undefined;
  const bodyKinds = ["data", "form", "multipart"].filter(
    (key) => source[key] !== undefined,
  );
  if (bodyKinds.length > 1) {
    throw new Error("Credential-gated requests accept only one body encoding.");
  }
  if (source.data !== undefined) {
    if (Buffer.isBuffer(source.data)) {
      body = source.data;
    } else if (typeof source.data === "string") {
      body = Buffer.from(source.data);
    } else {
      body = Buffer.from(JSON.stringify(source.data));
      headers["content-type"] ??= "application/json";
    }
  } else if (source.form !== undefined) {
    if (!isPlainObject(source.form)) {
      throw new Error("Credential-gated form data must be a plain object.");
    }
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(source.form)) {
      form.append(name, String(value));
    }
    body = Buffer.from(form.toString());
    headers["content-type"] ??= "application/x-www-form-urlencoded";
  } else if (source.multipart !== undefined) {
    const multipart = encodeMultipartBody(source.multipart);
    body = multipart.body;
    headers["content-type"] ??= multipart.contentType;
  }
  if (body) headers["content-length"] = String(body.length);
  return {
    body,
    headers,
    timeoutMs:
      typeof source.timeout === "number" && source.timeout > 0
        ? source.timeout
        : 120_000,
    url: url.toString(),
  };
}

function appendSearchParams(url: URL, params: unknown): void {
  if (params === undefined) return;
  if (typeof params === "string" || params instanceof URLSearchParams) {
    for (const [name, value] of new URLSearchParams(params)) {
      url.searchParams.append(name, value);
    }
    return;
  }
  if (!isPlainObject(params)) {
    throw new Error("Credential-gated query params must be serializable.");
  }
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
    } else if (value !== undefined) {
      url.searchParams.append(name, String(value));
    }
  }
}

function encodeMultipartBody(value: unknown): {
  body: Buffer;
  contentType: string;
} {
  if (!isPlainObject(value)) {
    throw new Error("Credential-gated multipart data must be a plain object.");
  }
  const boundary = `----textiq-e2e-${process.pid}-${multipartSequence++}`;
  const chunks: Buffer[] = [];
  for (const [name, part] of Object.entries(value)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (
      isPlainObject(part) &&
      typeof part.name === "string" &&
      Buffer.isBuffer(part.buffer)
    ) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeMultipart(name)}"; filename="${escapeMultipart(part.name)}"\r\n`,
        ),
      );
      chunks.push(
        Buffer.from(
          `Content-Type: ${
            typeof part.mimeType === "string"
              ? part.mimeType
              : "application/octet-stream"
          }\r\n\r\n`,
        ),
      );
      chunks.push(part.buffer, Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeMultipart(name)}"\r\n\r\n${String(part)}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function escapeMultipart(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

function snapshotVerifiedResponse(response: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  status: number;
  statusText: string;
  url: string;
}): UnauthenticatedE2EApiResponse {
  const headers = Object.fromEntries(
    Object.entries(response.headers)
      .filter(
        (entry): entry is [string, string | string[]] => entry[1] !== undefined,
      )
      .map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
  );
  return {
    body: async () => Buffer.from(response.body),
    headers: () => ({ ...headers }),
    headersArray: () =>
      Object.entries(headers).map(([name, value]) => ({ name, value })),
    json: async () => JSON.parse(response.body.toString("utf8")),
    ok: () => response.status >= 200 && response.status <= 299,
    status: () => response.status,
    statusText: () => response.statusText,
    text: async () => response.body.toString("utf8"),
    url: () => response.url,
  };
}

/**
 * Makes intentionally credential-free probes explicit at their call sites.
 * Every operation uses and disposes a fresh API context with empty storage.
 */
export function unauthenticatedRequest(
  defaults: UnauthenticatedRequestDefaults = {},
): UnauthenticatedE2EApiRequest {
  const sanitizedDefaults = sanitizePublicRequestDefaults(defaults);
  return {
    get: async (...args) =>
      executeUnauthenticatedRequest("get", sanitizedDefaults, args),
    head: async (...args) =>
      executeUnauthenticatedRequest("head", sanitizedDefaults, args),
  };
}

async function executeUnauthenticatedRequest<Method extends "get" | "head">(
  method: Method,
  defaults: Required<Pick<UnauthenticatedRequestDefaults, "baseURL">> &
    Pick<UnauthenticatedRequestDefaults, "extraHTTPHeaders">,
  args: Parameters<APIRequestContext[Method]>,
): Promise<UnauthenticatedE2EApiResponse> {
  const [url, options] = args;
  validatePublicRequestTarget(url, defaults.baseURL);
  const requestOptions = sanitizePublicRequestOptions(options);
  const context = await request.newContext({
    baseURL: defaults.baseURL,
    extraHTTPHeaders: sanitizePublicHeaders(
      defaults.extraHTTPHeaders,
      "default headers",
    ),
    maxRedirects: 0,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await context[method](url, {
      ...requestOptions,
      maxRedirects: 0,
    });
    return await snapshotResponse(response);
  } finally {
    await context.dispose();
  }
}

function sanitizePublicRequestDefaults(
  value: UnauthenticatedRequestDefaults,
): Required<Pick<UnauthenticatedRequestDefaults, "baseURL">> &
  Pick<UnauthenticatedRequestDefaults, "extraHTTPHeaders"> {
  if (!isPlainObject(value)) {
    throw new Error(
      "unauthenticatedRequest accepts options, not a BrowserContext or APIRequestContext.",
    );
  }
  const unexpected = Object.keys(value).filter(
    (key) => key !== "baseURL" && key !== "extraHTTPHeaders",
  );
  if (unexpected.length > 0) {
    throw new Error(
      `unauthenticatedRequest does not accept credential-sharing defaults: ${unexpected.join(", ")}.`,
    );
  }
  const baseURL = value.baseURL ?? configuredE2EOrigin();
  validatePublicBaseUrl(baseURL);
  return {
    baseURL,
    extraHTTPHeaders: sanitizePublicHeaders(
      value.extraHTTPHeaders,
      "default headers",
    ),
  };
}

function configuredE2EOrigin() {
  if (!process.env.E2E_BASE_URL) {
    throw new Error(
      "E2E_BASE_URL must be initialized by the Playwright configuration.",
    );
  }
  return process.env.E2E_BASE_URL;
}

function validatePublicBaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The unauthenticated request baseURL must be absolute.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The unauthenticated request baseURL must be a credential-free HTTP(S) origin.",
    );
  }
}

function validatePublicRequestTarget(value: string, baseURL: string): void {
  let target: URL;
  try {
    target = new URL(value, baseURL);
  } catch {
    throw new Error("The unauthenticated request URL is invalid.");
  }
  if (
    target.username ||
    target.password ||
    target.origin !== new URL(baseURL).origin
  ) {
    throw new Error(
      "Unauthenticated requests require a credential-free same-origin URL.",
    );
  }
}

function sanitizePublicHeaders(
  headers: Record<string, string> | undefined,
  label: string,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  if (!isPlainObject(headers)) {
    throw new Error(`Unauthenticated ${label} must be a plain header object.`);
  }
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      CREDENTIAL_HEADER_NAMES.has(normalized) ||
      CREDENTIAL_HEADER_PATTERN.test(normalized)
    ) {
      throw new Error(
        `Unauthenticated requests reject credential header "${name}".`,
      );
    }
    if (!SAFE_PUBLIC_REQUEST_HEADERS.has(normalized)) {
      throw new Error(
        `Unauthenticated requests reject non-standard header "${name}".`,
      );
    }
    if (typeof value !== "string") {
      throw new Error(`Unauthenticated header "${name}" must be a string.`);
    }
    sanitized[normalized] = value;
  }
  return sanitized;
}

function sanitizeCredentialGatedOptions<
  Options extends { headers?: Record<string, string> } | undefined,
>(options: Options): Options {
  if (options === undefined) return options;
  if (!isPlainObject(options)) {
    throw new Error("Credential-gated request options must be a plain object.");
  }
  return {
    ...options,
    headers: sanitizeCredentialFreeHeaders(
      options.headers,
      "credential-gated request headers",
    ),
  } as Options;
}

function sanitizePublicRequestOptions<
  Options extends { headers?: Record<string, string> } | undefined,
>(options: Options): Options {
  if (options === undefined) return options;
  if (!isPlainObject(options)) {
    throw new Error("Unauthenticated request options must be a plain object.");
  }
  return {
    ...options,
    headers: sanitizePublicHeaders(options.headers, "request headers"),
  } as Options;
}

function sanitizeCredentialFreeHeaders(
  headers: Record<string, string> | undefined,
  label: string,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  if (!isPlainObject(headers)) {
    throw new Error(`${label} must be a plain header object.`);
  }
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      CREDENTIAL_HEADER_NAMES.has(normalized) ||
      CREDENTIAL_HEADER_PATTERN.test(normalized)
    ) {
      throw new Error(
        `Credential-gated requests reject credential header "${name}".`,
      );
    }
    if (typeof value !== "string") {
      throw new Error(`Credential-gated header "${name}" must be a string.`);
    }
    sanitized[normalized] = value;
  }
  return sanitized;
}

async function snapshotResponse(
  response: APIResponse,
): Promise<UnauthenticatedE2EApiResponse> {
  const body = await response.body();
  const headers = response.headers();
  const headersArray = response.headersArray();
  const status = response.status();
  const statusText = response.statusText();
  const url = response.url();
  return {
    body: async () => Buffer.from(body),
    headers: () => ({ ...headers }),
    headersArray: () => headersArray.map((header) => ({ ...header })),
    json: async () => JSON.parse(body.toString("utf8")),
    ok: () => status >= 200 && status <= 299,
    status: () => status,
    statusText: () => statusText,
    text: async () => body.toString("utf8"),
    url: () => url,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
