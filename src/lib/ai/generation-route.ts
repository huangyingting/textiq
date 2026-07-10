import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  AzureConfigError,
  azureChatComplete,
  getAzureConfig,
  type AzureCompleteOptions,
  type AzureConfig,
} from "@/lib/ai/azure";
import {
  GENERATE_TIMEOUT_MS,
  GenerateTimeoutError,
  withAbortDeadline,
} from "@/lib/ai/deadline";
import {
  ANON_COOKIE_NAME,
  anonTrialLimit,
  checkRateLimitWithStore,
  newAnonState,
  parseAnonCookie,
  signAnonState,
  type AnonState,
  type RateLimitStore,
} from "@/lib/ai/quota";
import type { ChatMessage } from "@/lib/ai/prompt";
import { type CompleteFn } from "@/lib/ai/generation-runner";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import {
  captureMeteredUsage,
  refundMeteredUsage,
  reserveMeteredUsage,
  type CaptureMeteredUsageResult,
  type MeteredUsageReservation,
  type ReserveMeteredUsageResult,
} from "@/lib/billing/metered-usage";
import { ABUSE_CATEGORIES, logRouteDenial } from "@/lib/diagnostics/api-abuse";
import { auth as authEnv } from "@/lib/env";
import { logError } from "@/lib/log";
import { AI_JSON_BODY_MAX_BYTES } from "@/lib/limits";
import { prismaRateLimitStore, rateLimitSubject } from "@/lib/rate-limit";
import {
  checkIpRateLimit,
  abuseBudgetOptions,
  type AbuseBudgetCheck,
  type AbuseBudgetNamespaceId,
} from "@/lib/abuse-budget";
import { getCurrentUser } from "@/lib/session";
import {
  API_ERROR_CODES,
  codeForStatus,
  featureDisabled,
  paymentRequired,
  rawErrorResponse,
  serverError,
  tooManyRequests,
  validationError,
  type ApiErrorCode,
} from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/route-adapters";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface GenerationRouteRequest {
  json(): Promise<unknown>;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
  headers: Headers;
  cookies: {
    get(name: string): { value: string } | undefined;
  };
}

export interface GenerationRouteUser {
  id: string;
}

export type PayloadParseResult<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; status: number; message: string; headers?: HeadersInit };

export interface GenerationRouteErrorMapping {
  status: number;
  message: string;
  code?: ApiErrorCode;
  log?: {
    reason: string;
    status: number;
  };
}

export interface GenerationRouteContext<TPayload> {
  payload: TPayload;
  requestId: string;
  user: GenerationRouteUser | null;
  complete: CompleteFn;
}

/* node:coverage disable */
export interface GenerationRouteSuccessContext<TPayload> {
  payload: TPayload;
  requestId: string;
  user: GenerationRouteUser | null;
  latencyMs: number;
}

export interface GenerationRouteConfig<TPayload, TResult> {
  logScope: string;
  operation: string;
  rateLimitSubjects: {
    user: string;
    anonymousIp: string;
  };
  anonymousQuotaExceededMessage: string;
  unexpectedErrorMessage: string;
  azureMaxOutputTokens?: number;
  parsePayload(body: Record<string, unknown>): PayloadParseResult<TPayload>;
  creditText(payload: TPayload): string;
  generate(context: GenerationRouteContext<TPayload>): Promise<TResult>;
  successResponse(
    result: TResult,
    context: GenerationRouteSuccessContext<TPayload>,
  ): NextResponse;
  mapGenerationError(
    error: unknown,
    context: { payload: TPayload; requestId: string },
  ): GenerationRouteErrorMapping | null;
  onSuccess?(
    result: TResult,
    context: GenerationRouteSuccessContext<TPayload>,
  ): void | Promise<void>;
}

interface CookieWriter {
  commit(): void;
  readonly value: string | null;
}

export interface GenerationRouteDeps {
  requestId(): string;
  now(): number;
  getSecret(): string | undefined;
  getAzureConfig(): AzureConfig;
  azureChatComplete(
    messages: ChatMessage[],
    options: AzureCompleteOptions,
  ): Promise<string>;
  withAbortDeadline<T>(
    factory: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T>;
  timeoutMs: number;
  getCurrentUser(): Promise<GenerationRouteUser | null>;
  rateLimitStore: RateLimitStore;
  checkRateLimitWithStore: typeof checkRateLimitWithStore;
  rateLimitSubject(scope: string, identifier: string): string;
  userRateLimit(): number;
  userRateWindowMs(): number;
  /** Checks IP-based rate limit; replaces the former getClientIp/hashIdentifier/anonIp* deps. */
  checkIpRateLimit(opts: {
    namespace: string;
    headers: Headers;
    secret: string;
    now: number;
  }): Promise<AbuseBudgetCheck>;
  anonTrialLimit(): number;
  parseAnonCookie(
    value: string | undefined | null,
    secret: string,
  ): AnonState | null;
  newAnonState(): AnonState;
  signAnonState(state: AnonState, secret: string): string;
  reserveMeteredUsage(opts: {
    idempotencyKey: string;
    userId: string;
    operation: string;
    creditText: string;
  }): Promise<ReserveMeteredUsageResult>;
  captureMeteredUsage(
    reservation: MeteredUsageReservation,
  ): Promise<CaptureMeteredUsageResult>;
  refundMeteredUsage(reservation: MeteredUsageReservation): Promise<void>;
  isAzureConfigError(error: unknown): boolean;
  isTimeoutError(error: unknown): boolean;
  isInsufficientCreditsError(error: unknown): boolean;
  logError(
    scope: string,
    error: unknown,
    fields?: Record<string, unknown>,
  ): void;
  logRouteDenial(opts: Parameters<typeof logRouteDenial>[0]): void;
}
/* node:coverage enable */

const defaultDeps: GenerationRouteDeps = {
  requestId: randomUUID,
  now: Date.now,
  getSecret: authEnv.secret,
  getAzureConfig,
  azureChatComplete,
  withAbortDeadline,
  timeoutMs: GENERATE_TIMEOUT_MS,
  getCurrentUser,
  rateLimitStore: prismaRateLimitStore,
  checkRateLimitWithStore,
  rateLimitSubject,
  userRateLimit: () => abuseBudgetOptions("ai.visual.user").limit,
  userRateWindowMs: () => abuseBudgetOptions("ai.visual.user").windowMs,
  checkIpRateLimit: (opts) =>
    checkIpRateLimit({
      ...opts,
      namespace: opts.namespace as AbuseBudgetNamespaceId,
    }),
  anonTrialLimit,
  parseAnonCookie,
  newAnonState,
  signAnonState,
  reserveMeteredUsage,
  captureMeteredUsage,
  refundMeteredUsage,
  isAzureConfigError: (error) => error instanceof AzureConfigError,
  isTimeoutError: (error) => error instanceof GenerateTimeoutError,
  isInsufficientCreditsError: (error) =>
    error instanceof InsufficientCreditsError,
  logError,
  logRouteDenial,
};

function createAzureComplete(
  deps: Pick<
    GenerationRouteDeps,
    "azureChatComplete" | "getAzureConfig" | "timeoutMs" | "withAbortDeadline"
  >,
  maxOutputTokens?: number,
): CompleteFn {
  const config = deps.getAzureConfig();
  return (messages) =>
    deps.withAbortDeadline(
      (signal) =>
        deps.azureChatComplete(messages, {
          config,
          signal,
          maxOutputTokens,
        }),
      deps.timeoutMs,
    );
}

/* node:coverage disable */
export function createGenerationRouteHandler<TPayload, TResult>(
  config: GenerationRouteConfig<TPayload, TResult>,
  overrides: Partial<GenerationRouteDeps> = {},
): (request: GenerationRouteRequest) => Promise<NextResponse> {
  const deps: GenerationRouteDeps = { ...defaultDeps, ...overrides };

  return async function handleGenerationRoute(
    request: GenerationRouteRequest,
  ): Promise<NextResponse> {
    /* node:coverage enable */
    const requestId = deps.requestId();

    const json = await readJsonObject(request, {
      maxBytes: AI_JSON_BODY_MAX_BYTES,
      tooLargeMessage: "AI request body is too large.",
    });
    if (!json.ok) {
      return json.response;
    }

    const parsed = config.parsePayload(json.body);
    if (!parsed.ok) {
      return validationError(parsed.message, parsed.status);
    }
    const { payload } = parsed;

    const secret = deps.getSecret();
    if (!secret) {
      deps.logError(config.logScope, new Error("Missing AUTH_SECRET"), {
        requestId,
        reason: "missing-auth-secret",
        status: 500,
      });
      return serverError("Server is misconfigured (missing AUTH_SECRET).");
    }

    let complete: CompleteFn;
    try {
      complete = createAzureComplete(deps, config.azureMaxOutputTokens);
    } catch (error) {
      if (deps.isAzureConfigError(error)) {
        deps.logError(config.logScope, error, {
          requestId,
          reason: "azure-config",
          status: 503,
        });
        return featureDisabled("AI generation is not configured.");
      }
      deps.logError(config.logScope, error, {
        requestId,
        reason: "azure-config-unexpected",
        status: 500,
      });
      throw error;
    }

    const user = await deps.getCurrentUser();
    let commitAnonUsage: CookieWriter | null = null;
    let meteredUsage: MeteredUsageReservation | null = null;

    if (user) {
      const rateLimit = await checkUserRateLimit(config, deps, user);
      if (rateLimit) {
        return rateLimit;
      }

      const credit = await checkAndReserveCredits(
        config,
        deps,
        payload,
        user,
        requestId,
      );
      if ("response" in credit) {
        return credit.response;
      }
      meteredUsage = credit.reservation;
    } else {
      const anon = await checkAnonymousAccess(config, deps, request, secret);
      if ("response" in anon) {
        return anon.response;
      }
      commitAnonUsage = anon.cookieWriter;
    }

    try {
      const generationStartedAt = deps.now();
      const result = await config.generate({
        payload,
        requestId,
        user,
        complete,
      });
      const successContext: GenerationRouteSuccessContext<TPayload> = {
        payload,
        requestId,
        user,
        latencyMs: deps.now() - generationStartedAt,
      };

      commitAnonUsage?.commit();

      const capture = await captureCredits(config, deps, meteredUsage);
      if (capture) {
        return capture;
      }

      const response = config.successResponse(result, successContext);
      if (commitAnonUsage?.value) {
        response.cookies.set(ANON_COOKIE_NAME, commitAnonUsage.value, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          /* node:coverage ignore next 2 */
          maxAge: ONE_YEAR_SECONDS,
        });
      }

      await config.onSuccess?.(result, successContext);

      return response;
    } catch (error) {
      /* node:coverage ignore next 5 -- Refund-on-error branch is asserted; tsx maps the optional ledger guard as uncovered. */
      if (meteredUsage?.ledgerReserved) {
        await deps.refundMeteredUsage(meteredUsage).catch((refundErr) => {
          deps.logError(config.logScope, refundErr, {
            /* node:coverage ignore next 3 */
            requestId,
            reason: "ledger-refund-failed",
          });
        });
      }

      if (deps.isTimeoutError(error)) {
        deps.logError(config.logScope, error, {
          requestId,
          reason: "timeout",
          status: 504,
        });
        deps.logRouteDenial({
          route: config.logScope,
          reason: ABUSE_CATEGORIES.AI_TIMEOUT,
          status: 504,
          userId: user?.id,
        });
        return rawErrorResponse(
          504,
          API_ERROR_CODES.SERVER_ERROR,
          "The AI took too long to respond. Please try again.",
        );
      }

      const mapped = config.mapGenerationError(error, { payload, requestId });
      if (mapped) {
        if (mapped.log) {
          deps.logError(config.logScope, error, {
            requestId,
            reason: mapped.log.reason,
            status: mapped.log.status,
          });
        }
        const code: ApiErrorCode = mapped.code ?? codeForStatus(mapped.status);
        return rawErrorResponse(mapped.status, code, mapped.message);
      }

      deps.logError(config.logScope, error, {
        requestId,
        reason: "unexpected",
        status: 500,
      });
      return serverError(config.unexpectedErrorMessage);
    }
  };
}

async function checkUserRateLimit<TPayload, TResult>(
  config: GenerationRouteConfig<TPayload, TResult>,
  deps: GenerationRouteDeps,
  user: GenerationRouteUser,
): Promise<NextResponse | null> {
  const result = await deps.checkRateLimitWithStore(
    deps.rateLimitStore,
    deps.rateLimitSubject(config.rateLimitSubjects.user, user.id),
    {
      limit: deps.userRateLimit(),
      windowMs: deps.userRateWindowMs(),
      now: deps.now(),
    },
  );
  if (result.allowed) {
    return null;
  }

  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt - deps.now()) / 1000),
  );
  deps.logRouteDenial({
    route: config.logScope,
    reason: ABUSE_CATEGORIES.RATE_LIMIT_HIT,
    status: 429,
    userId: user.id,
    retryAfterSeconds: retryAfter,
  });
  return tooManyRequests(
    retryAfter,
    "Rate limit exceeded. Please wait a moment and try again.",
  );
}

async function checkAndReserveCredits<TPayload, TResult>(
  config: GenerationRouteConfig<TPayload, TResult>,
  deps: GenerationRouteDeps,
  payload: TPayload,
  user: GenerationRouteUser,
  requestId: string,
): Promise<
  { reservation: MeteredUsageReservation } | { response: NextResponse }
> {
  const result = await deps.reserveMeteredUsage({
    idempotencyKey: requestId,
    userId: user.id,
    operation: config.operation,
    creditText: config.creditText(payload),
  });
  if (!result.ok) {
    deps.logRouteDenial({
      route: config.logScope,
      reason: ABUSE_CATEGORIES.CREDIT_DENIED,
      status: 402,
      userId: user.id,
    });
    return {
      response: paymentRequired(result.message),
    };
  }

  return { reservation: result.reservation };
}

async function checkAnonymousAccess<TPayload, TResult>(
  config: GenerationRouteConfig<TPayload, TResult>,
  deps: GenerationRouteDeps,
  request: GenerationRouteRequest,
  secret: string,
): Promise<{ cookieWriter: CookieWriter } | { response: NextResponse }> {
  const now = deps.now();
  const ipCheck = await deps.checkIpRateLimit({
    namespace: config.rateLimitSubjects.anonymousIp,
    headers: request.headers,
    secret,
    now,
  });

  if (!ipCheck.allowed) {
    deps.logRouteDenial({
      route: config.logScope,
      reason: ABUSE_CATEGORIES.RATE_LIMIT_HIT,
      status: 429,
      subjectHash: ipCheck.subjectHash,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
    });
    return {
      response: tooManyRequests(
        ipCheck.retryAfterSeconds,
        "Too many anonymous generations from your network. Please wait and try again, or sign in.",
      ),
    };
  }

  const state =
    deps.parseAnonCookie(
      request.cookies.get(ANON_COOKIE_NAME)?.value,
      secret,
    ) ?? deps.newAnonState();
  if (state.count >= deps.anonTrialLimit()) {
    deps.logRouteDenial({
      route: config.logScope,
      reason: ABUSE_CATEGORIES.ANON_QUOTA_DENIED,
      status: 429,
      subjectHash: ipCheck.subjectHash,
    });
    return {
      response: tooManyRequests(
        undefined,
        config.anonymousQuotaExceededMessage,
      ),
    };
  }

  let setAnonCookie: string | null = null;
  return {
    cookieWriter: {
      commit() {
        const next = { id: state.id, count: state.count + 1 };
        setAnonCookie = deps.signAnonState(next, secret);
      },
      get value() {
        return setAnonCookie;
      },
    },
  };
}

async function captureCredits<TPayload, TResult>(
  config: GenerationRouteConfig<TPayload, TResult>,
  deps: GenerationRouteDeps,
  meteredUsage: MeteredUsageReservation | null,
): Promise<NextResponse | null> {
  if (!meteredUsage || meteredUsage.creditCost <= 0) {
    return null;
  }

  const result = await deps.captureMeteredUsage(meteredUsage);
  if (result.ok) {
    return null;
  }
  if (
    result.insufficientCredits ||
    deps.isInsufficientCreditsError(result.error)
  ) {
    deps.logRouteDenial({
      route: config.logScope,
      reason: ABUSE_CATEGORIES.CREDIT_DENIED,
      status: 402,
      userId: meteredUsage.userId,
    });
    return paymentRequired(
      result.error instanceof Error
        ? result.error.message
        : "Insufficient credits.",
    );
  }
  deps.logError(config.logScope, result.error, {
    requestId: meteredUsage.idempotencyKey,
    reason: "credit-capture-failed",
  });
  return null;
}
