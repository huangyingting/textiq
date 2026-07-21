/**
 * Centralized, validated environment-config module (#150).
 *
 * A single, typed surface for every server-side environment variable the app
 * reads, grouped by concern (auth, db, stripe/billing, azure/ai, app url,
 * google oauth). It replaces the scattered raw `process.env.*` reads that each
 * carried their own ad-hoc fallback and error handling.
 *
 * Design notes
 * ------------
 * - **Read-at-call-time, not frozen-at-import.** Accessors read `process.env`
 *   when invoked rather than snapshotting it once. This keeps existing
 *   semantics (e.g. {@link isGoogleAuthConfigured}, the DB resolvers) and lets
 *   tests mutate `process.env` between calls. The "validated" guarantee is
 *   enforced at the point of use: required accessors throw a clear
 *   {@link MissingEnvError} that names the offending variable instead of
 *   failing late and deep inside a request with an opaque error.
 * - **Required-always vs feature-gated.** Only variables the app genuinely
 *   needs everywhere are exposed as `require*` accessors. Feature-gated
 *   surfaces (Stripe billing, Azure generation, Google OAuth) expose
 *   `isConfigured()` predicates plus required getters that are only invoked
 *   once the feature is known to be enabled — preserving the SQLite/dev
 *   defaults and the existing "feature configured?" checks so dev/test keep
 *   working with just `AUTH_SECRET` + the SQLite defaults.
 * - **DB is delegated, not duplicated.** Database resolution stays in
 *   `@/lib/db-provider` (the single source of truth from #147); the `db`
 *   export simply re-exposes it under the unified surface.
 * - **NEXT_PUBLIC_* vars.** Only *server-side* reads are centralized here. Client
 *   code uses `@/lib/client-config`, which keeps literal
 *   `process.env.NEXT_PUBLIC_*` reads so Next can inline them into the bundle.
 */

import { resolveProvider, resolveUrl } from "@/lib/db-provider";

/** Thrown when a required environment variable is missing or blank. */
export class MissingEnvError extends Error {
  /** The name of the missing environment variable. */
  readonly variable: string;

  constructor(variable: string, hint?: string) {
    super(
      `Missing required environment variable: ${variable}.` +
        (hint ? ` ${hint}` : ""),
    );
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}

/**
 * Reads an env var, trimming whitespace and treating blank/whitespace-only
 * values as absent (returns `undefined`). Mirrors the falsy-empty handling the
 * scattered reads relied on (`process.env.X || default`, `if (!x)`).
 */
function readOptional(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Reads a positive integer env var. Missing, blank, invalid, zero, and negative
 * values all return the provided fallback.
 */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads a required env var, throwing {@link MissingEnvError} when absent. */
function readRequired(name: string, hint?: string): string {
  const value = readOptional(name);
  if (value === undefined) throw new MissingEnvError(name, hint);
  return value;
}

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * `AUTH_SECRET` is required in production but the runtime tolerates its absence
 * by returning a 500 from the routes that need it, so it is exposed both as an
 * optional getter (for those graceful checks) and a required accessor.
 */
export const auth = {
  /** The session-encryption secret, or `undefined` when unset. */
  secret(): string | undefined {
    return readOptional("AUTH_SECRET");
  },
  /** The session-encryption secret; throws when unset. */
  requireSecret(): string {
    return readRequired(
      "AUTH_SECRET",
      "Generate one with `npx auth secret` (or `openssl rand -base64 32`).",
    );
  },
} as const;

/**
 * Database configuration — delegated to `@/lib/db-provider`, the single source
 * of truth for provider/URL resolution (#147). Re-exposed here so the full env
 * surface is visible in one place without duplicating the resolution logic.
 */
export const db = {
  /** Resolved provider: `"postgres"` or `"sqlite"` (SQLite is the default). */
  provider: resolveProvider,
  /** Effective `DATABASE_URL` (SQLite falls back to the local dev file). */
  url: resolveUrl,
} as const;

/**
 * Stripe billing configuration (US-010) — feature-gated on `STRIPE_SECRET_KEY`.
 * Provider *selection* (incl. the production fail-closed rule) lives in
 * `@/lib/billing/provider`; this surface only reads the raw Stripe vars.
 */
export const stripe = {
  /** True when a Stripe secret key is present (real billing is configured). */
  isConfigured(): boolean {
    return readOptional("STRIPE_SECRET_KEY") !== undefined;
  },
  /** Stripe secret key; throws when unset. */
  secretKey(): string {
    return readRequired("STRIPE_SECRET_KEY");
  },
  /** Stripe Price id for the Plus plan; throws when unset. */
  plusPriceId(): string {
    return readRequired("STRIPE_PLUS_PRICE_ID");
  },
  /** Stripe Price id for the Pro plan; throws when unset. */
  proPriceId(): string {
    return readRequired("STRIPE_PRO_PRICE_ID");
  },
  /** Webhook signing secret, or `undefined` when unset. */
  webhookSecret(): string | undefined {
    return readOptional("STRIPE_WEBHOOK_SECRET");
  },
} as const;

/**
 * Azure OpenAI configuration (US-010) — feature-gated on the endpoint + key.
 * Deployment and api-version are optional; callers apply their own documented
 * defaults (see `@/lib/ai/azure`).
 */
export const azure = {
  /** True when both the endpoint and API key are present. */
  isConfigured(): boolean {
    return (
      readOptional("AZURE_OPENAI_ENDPOINT") !== undefined &&
      readOptional("AZURE_OPENAI_API_KEY") !== undefined
    );
  },
  /** Azure OpenAI resource endpoint, or `undefined` when unset. */
  endpoint(): string | undefined {
    return readOptional("AZURE_OPENAI_ENDPOINT");
  },
  /** Azure OpenAI resource key, or `undefined` when unset. */
  apiKey(): string | undefined {
    return readOptional("AZURE_OPENAI_API_KEY");
  },
  /** Deployment name, or `undefined` when unset (caller supplies a default). */
  deployment(): string | undefined {
    return readOptional("AZURE_OPENAI_DEPLOYMENT");
  },
  /** REST api-version, or `undefined` when unset (caller supplies a default). */
  apiVersion(): string | undefined {
    return readOptional("AZURE_OPENAI_API_VERSION");
  },
} as const;

/**
 * Google OAuth (Auth.js) configuration — feature-gated. The sign-in provider is
 * only wired up when both values are present (see `@/lib/auth/google-provider`,
 * which delegates its predicate here).
 */
export const google = {
  /** True when both client id and secret are present. */
  isConfigured(): boolean {
    return (
      readOptional("GOOGLE_CLIENT_ID") !== undefined &&
      readOptional("GOOGLE_CLIENT_SECRET") !== undefined
    );
  },
  /** Google OAuth client id; throws when unset. */
  clientId(): string {
    return readRequired("GOOGLE_CLIENT_ID");
  },
  /** Google OAuth client secret; throws when unset. */
  clientSecret(): string {
    return readRequired("GOOGLE_CLIENT_SECRET");
  },
} as const;

/** Default canonical app origin used when `NEXT_PUBLIC_APP_URL` is unset. */
const DEFAULT_APP_URL = "http://localhost:4000";

/**
 * Public app origin configuration.
 *
 * NOTE: this is a **server-side** accessor. Client code should use
 * `@/lib/client-config` so Next can inline public values into the client bundle.
 */
export const app = {
  /**
   * The canonical app origin (`NEXT_PUBLIC_APP_URL`), or `fallback` when unset.
   *
   * @param fallback origin to use when the var is absent
   *   (defaults to {@link DEFAULT_APP_URL}).
   */
  url(fallback: string = DEFAULT_APP_URL): string {
    return readOptional("NEXT_PUBLIC_APP_URL") ?? fallback;
  },
} as const;
