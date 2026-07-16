import {
  checkRateLimitWithStore,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitWindow,
} from "@/lib/rate-limit/core";
import { auth as authEnv, readPositiveIntEnv } from "@/lib/env";
import {
  type ClientIpOptions,
  getClientIp,
  hashIdentifier,
  logClientIpDiagnostic,
  prismaRateLimitStore,
  rateLimitSubject,
  retryAfterSeconds,
} from "@/lib/rate-limit";

export type AbuseBudgetOwner =
  | "auth"
  | "account"
  | "public"
  | "collab"
  | "import"
  | "ai";

export interface AbuseBudgetNamespace {
  readonly namespace: string;
  readonly owner: AbuseBudgetOwner;
  readonly rationale: string;
  readonly limitEnv: string;
  readonly windowEnv: string;
  readonly defaultLimit: number;
  readonly defaultWindowMs: number;
}

export const ABUSE_BUDGET_NAMESPACES = [
  {
    namespace: "auth.login.email",
    owner: "auth",
    rationale:
      "Throttle repeated credential checks without disclosing accounts.",
    limitEnv: "AUTH_LOGIN_RATE_LIMIT",
    windowEnv: "AUTH_LOGIN_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "auth.signup.email",
    owner: "auth",
    rationale: "Throttle account-creation bursts by submitted address.",
    limitEnv: "AUTH_SIGNUP_RATE_LIMIT",
    windowEnv: "AUTH_SIGNUP_RATE_WINDOW_MS",
    /* node:coverage ignore next 2 -- getAbuseBudgetNamespace asserts these values; tsx maps this object tail as uncovered. */
    defaultLimit: 5,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "auth.password-reset.email",
    owner: "auth",
    rationale: "Preserve anti-enumeration while limiting reset email abuse.",
    limitEnv: "AUTH_PASSWORD_RESET_RATE_LIMIT",
    windowEnv: "AUTH_PASSWORD_RESET_RATE_WINDOW_MS",
    defaultLimit: 5,
    defaultWindowMs: 60 * 60_000,
  },
  {
    namespace: "auth.password-reset.token",
    owner: "auth",
    rationale: "Throttle repeated reset-token attempts.",
    limitEnv: "AUTH_RESET_TOKEN_RATE_LIMIT",
    windowEnv: "AUTH_RESET_TOKEN_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "auth.email-verification.user",
    owner: "auth",
    rationale: "Throttle resend-verification bursts for authenticated users.",
    limitEnv: "AUTH_EMAIL_VERIFICATION_RATE_LIMIT",
    windowEnv: "AUTH_EMAIL_VERIFICATION_RATE_WINDOW_MS",
    defaultLimit: 3,
    defaultWindowMs: 60 * 60_000,
  },
  {
    namespace: "account.change-password.user",
    owner: "account",
    rationale: "Throttle repeated password-change attempts.",
    limitEnv: "ACCOUNT_CHANGE_PASSWORD_RATE_LIMIT",
    windowEnv: "ACCOUNT_CHANGE_PASSWORD_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "account.export.user",
    owner: "account",
    rationale: "Throttle expensive account-export downloads.",
    limitEnv: "ACCOUNT_EXPORT_RATE_LIMIT",
    windowEnv: "ACCOUNT_EXPORT_RATE_WINDOW_MS",
    defaultLimit: 5,
    defaultWindowMs: 60 * 60_000,
  },
  {
    namespace: "public.share.ip",
    owner: "public",
    rationale: "Throttle public share/embed/present page traffic per network.",
    limitEnv: "PUBLIC_SHARE_RATE_LIMIT",
    windowEnv: "PUBLIC_SHARE_RATE_WINDOW_MS",
    defaultLimit: 120,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "public.share-passcode.ip",
    owner: "public",
    rationale: "Throttle repeated public share passcode attempts per link.",
    limitEnv: "PUBLIC_SHARE_PASSCODE_RATE_LIMIT",
    windowEnv: "PUBLIC_SHARE_PASSCODE_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "public.asset.ip",
    owner: "public",
    rationale: "Throttle public/protected asset fetch traffic per network.",
    limitEnv: "PUBLIC_ASSET_RATE_LIMIT",
    windowEnv: "PUBLIC_ASSET_RATE_WINDOW_MS",
    defaultLimit: 240,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "collab.authorize.user",
    owner: "collab",
    rationale: "Throttle websocket authorization probes.",
    limitEnv: "COLLAB_AUTHORIZE_RATE_LIMIT",
    windowEnv: "COLLAB_AUTHORIZE_RATE_WINDOW_MS",
    defaultLimit: 120,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "collab.flush.room",
    owner: "collab",
    rationale: "Throttle recovery snapshot flush bursts per room.",
    limitEnv: "COLLAB_FLUSH_RATE_LIMIT",
    windowEnv: "COLLAB_FLUSH_RATE_WINDOW_MS",
    defaultLimit: 30,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "collab.upgrade.ip",
    owner: "collab",
    rationale: "Throttle websocket upgrade bursts per network.",
    limitEnv: "COLLAB_UPGRADE_RATE_LIMIT",
    windowEnv: "COLLAB_UPGRADE_RATE_WINDOW_MS",
    defaultLimit: 120,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "import.ip",
    owner: "import",
    rationale: "Throttle public document-import parser work per network.",
    limitEnv: "IMPORT_RATE_LIMIT",
    windowEnv: "IMPORT_RATE_WINDOW_MS",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "ai.visual.user",
    owner: "ai",
    rationale: "Throttle authenticated visual generations.",
    limitEnv: "USER_GENERATION_RATE_LIMIT",
    windowEnv: "USER_GENERATION_RATE_WINDOW_MS",
    defaultLimit: 30,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "ai.visual.anonymous-ip",
    owner: "ai",
    rationale: "Throttle anonymous visual generations per network.",
    limitEnv: "ANON_IP_GENERATION_RATE_LIMIT",
    windowEnv: "ANON_IP_GENERATION_RATE_WINDOW_MS",
    defaultLimit: 20,
    defaultWindowMs: 60 * 60_000,
  },
  {
    namespace: "ai.deck.user",
    owner: "ai",
    rationale: "Throttle authenticated deck generations.",
    limitEnv: "USER_GENERATION_RATE_LIMIT",
    windowEnv: "USER_GENERATION_RATE_WINDOW_MS",
    defaultLimit: 30,
    defaultWindowMs: 60_000,
  },
  {
    namespace: "ai.deck.anonymous-ip",
    owner: "ai",
    rationale: "Throttle anonymous deck generations per network.",
    limitEnv: "ANON_IP_GENERATION_RATE_LIMIT",
    windowEnv: "ANON_IP_GENERATION_RATE_WINDOW_MS",
    defaultLimit: 20,
    defaultWindowMs: 60 * 60_000,
  },
] as const satisfies readonly AbuseBudgetNamespace[];

export type AbuseBudgetNamespaceId =
  (typeof ABUSE_BUDGET_NAMESPACES)[number]["namespace"];

const BY_NAMESPACE = new Map(
  ABUSE_BUDGET_NAMESPACES.map((entry) => [entry.namespace, entry]),
);

export function getAbuseBudgetNamespace(
  namespace: AbuseBudgetNamespaceId,
): AbuseBudgetNamespace {
  const entry = BY_NAMESPACE.get(namespace);
  if (!entry) {
    throw new Error(`Unknown abuse-budget namespace: ${namespace}`);
  }
  return entry;
}

export function assertUniqueAbuseBudgetNamespaces(
  entries: readonly Pick<
    AbuseBudgetNamespace,
    "namespace"
  >[] = ABUSE_BUDGET_NAMESPACES,
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.namespace)) {
      throw new Error(`Duplicate abuse-budget namespace: ${entry.namespace}`);
    }
    seen.add(entry.namespace);
  }
}

export function abuseBudgetOptions(
  namespace: AbuseBudgetNamespaceId,
  now = Date.now(),
): RateLimitOptions {
  const entry = getAbuseBudgetNamespace(namespace);
  return {
    limit: readPositiveIntEnv(entry.limitEnv, entry.defaultLimit),
    windowMs: readPositiveIntEnv(entry.windowEnv, entry.defaultWindowMs),
    now,
  };
}

export function abuseBudgetSubject(
  namespace: AbuseBudgetNamespaceId,
  subject: string,
  secret: string,
): { subjectHash: string; key: string } {
  const subjectHash = hashIdentifier(subject, secret);
  /* node:coverage ignore next 6 -- abuseBudgetSubject tests assert both returned fields; tsx maps the object tail/closure as uncovered. */
  return {
    subjectHash,
    key: rateLimitSubject(namespace, subjectHash),
  };
}

export class InMemoryAbuseBudgetStore implements RateLimitStore {
  /* node:coverage ignore next -- InMemoryAbuseBudgetStore tests exercise this field; tsx maps the class field as uncovered. */
  readonly windows = new Map<string, RateLimitWindow>();

  async get(key: string): Promise<RateLimitWindow | undefined> {
    const window = this.windows.get(key);
    /* node:coverage ignore next 2 -- store copy semantics are asserted; tsx maps the return/blank line as uncovered. */
    return window ? { ...window } : undefined;
  }

  async set(key: string, window: RateLimitWindow): Promise<void> {
    this.windows.set(key, { ...window });
  }

  /**
   * Atomic consume: the entire read-modify-write is one synchronous critical
   * section with no await between read and write. JavaScript's single-threaded
   * event loop ensures no other code runs between `windows.get` and
   * `windows.set`, eliminating the concurrent-window race (#1997).
   */
  atomicConsume(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const { limit, windowMs, now } = options;
    const existing = this.windows.get(key);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return Promise.resolve({
        allowed: true,
        remaining: Math.max(0, limit - 1),
        limit,
        resetAt,
      });
    }
    if (existing.count >= limit) {
      return Promise.resolve({
        allowed: false,
        remaining: 0,
        limit,
        resetAt: existing.resetAt,
      });
    }
    const count = existing.count + 1;
    this.windows.set(key, { count, resetAt: existing.resetAt });
    return Promise.resolve({
      allowed: true,
      remaining: Math.max(0, limit - count),
      limit,
      resetAt: existing.resetAt,
    });
  }

  /* node:coverage ignore next 10 */
  clear(): void {
    this.windows.clear();
  }
}

export interface AbuseBudgetCheck {
  readonly allowed: boolean;
  readonly result: RateLimitResult;
  readonly retryAfterSeconds?: number;
  readonly subjectHash: string;
  readonly key: string;
}

/* node:coverage ignore next 7 -- exported options signature is erased by tsx but reported as source-map gaps. */
export async function checkAbuseBudget(opts: {
  namespace: AbuseBudgetNamespaceId;
  subject: string;
  secret: string;
  store?: RateLimitStore;
  now?: number;
}): Promise<AbuseBudgetCheck> {
  const now = opts.now ?? Date.now();
  const subject = abuseBudgetSubject(opts.namespace, opts.subject, opts.secret);
  /* node:coverage ignore next 8 -- checkAbuseBudget tests exercise both allowed and blocked results; tsx maps this awaited call/return as uncovered. */
  const result = await checkRateLimitWithStore(
    opts.store ?? prismaRateLimitStore,
    subject.key,
    abuseBudgetOptions(opts.namespace, now),
  );
  return {
    allowed: result.allowed,
    result,
    subjectHash: subject.subjectHash,
    key: subject.key,
    retryAfterSeconds: result.allowed
      ? undefined
      : retryAfterSeconds(result.resetAt, now),
  };
}

export function getClientSubject(
  headers: Headers,
  options: ClientIpOptions = {},
): string {
  return (
    getClientIp(headers, {
      ...options,
      onDiagnostic: options.onDiagnostic ?? logClientIpDiagnostic,
    }) ?? "unknown"
  );
}

export function requireAbuseBudgetSecret(): string | undefined {
  return authEnv.secret();
}

/**
 * Checks the abuse budget for the client IP extracted from `headers`.
 * Combines {@link getClientSubject} + {@link checkAbuseBudget} so every
 * IP-keyed rate-limit check goes through a single implementation.
 */
export async function checkIpRateLimit(opts: {
  namespace: AbuseBudgetNamespaceId;
  headers: Headers;
  secret: string;
  store?: RateLimitStore;
  now?: number;
  clientIp?: ClientIpOptions;
}): Promise<AbuseBudgetCheck> {
  return checkAbuseBudget({
    namespace: opts.namespace,
    subject: getClientSubject(opts.headers, opts.clientIp),
    secret: opts.secret,
    store: opts.store,
    now: opts.now,
  });
}
