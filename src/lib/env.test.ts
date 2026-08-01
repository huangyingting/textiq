/**
 * Unit tests for the centralized env-config module (#150).
 *
 * DOM-free, no network, no DB: pure validation logic. Each accessor reads
 * `process.env` at call time, so the tests mutate the environment between
 * assertions and restore it afterwards for isolation.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  app,
  auth,
  authEmail,
  azure,
  db,
  google,
  readPositiveIntEnv,
  stripe,
  MissingEnvError,
} from "./env";

// ---------------------------------------------------------------------------
// Helpers: save / restore the env vars this suite mutates.
// ---------------------------------------------------------------------------

const MANAGED_VARS = [
  "AUTH_SECRET",
  "AUTH_EMAIL_DELIVERY",
  "AUTH_EMAIL_FROM",
  "RESEND_API_KEY",
  "DB_PROVIDER",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_PLUS_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "POSITIVE_INT_TEST",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of MANAGED_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of MANAGED_VARS) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

// ---------------------------------------------------------------------------
// readPositiveIntEnv
// ---------------------------------------------------------------------------

describe("readPositiveIntEnv", () => {
  it("returns the fallback when the variable is unset", () => {
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);
  });

  it("returns the fallback for invalid, zero, or negative values", () => {
    process.env.POSITIVE_INT_TEST = "abc";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = "";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = "0";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = "-3";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = "1e6";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = "5000ms";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);

    process.env.POSITIVE_INT_TEST = `${Number.MAX_SAFE_INTEGER + 1}`;
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 7);
  });

  it("returns a valid positive integer value", () => {
    process.env.POSITIVE_INT_TEST = " 42 ";
    assert.equal(readPositiveIntEnv("POSITIVE_INT_TEST", 7), 42);
  });
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("secret() returns undefined when AUTH_SECRET is unset", () => {
    assert.equal(auth.secret(), undefined);
  });

  it("secret() treats a blank value as absent", () => {
    process.env.AUTH_SECRET = "   ";
    assert.equal(auth.secret(), undefined);
  });

  it("secret() returns the trimmed value when set", () => {
    process.env.AUTH_SECRET = "  s3cret  ";
    assert.equal(auth.secret(), "s3cret");
  });

  it("requireSecret() throws MissingEnvError naming AUTH_SECRET when unset", () => {
    assert.throws(
      () => auth.requireSecret(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "AUTH_SECRET");
        assert.match(err.message, /AUTH_SECRET/);
        return true;
      },
    );
  });

  it("requireSecret() returns the value when set", () => {
    process.env.AUTH_SECRET = "s3cret";
    assert.equal(auth.requireSecret(), "s3cret");
  });
});

describe("authEmail", () => {
  it("returns undefined for missing or blank delivery configuration", () => {
    assert.equal(authEmail.delivery(), undefined);
    assert.equal(authEmail.from(), undefined);
    assert.equal(authEmail.resendApiKey(), undefined);

    process.env.AUTH_EMAIL_DELIVERY = "   ";
    process.env.AUTH_EMAIL_FROM = "";
    process.env.RESEND_API_KEY = "  ";
    assert.equal(authEmail.delivery(), undefined);
    assert.equal(authEmail.from(), undefined);
    assert.equal(authEmail.resendApiKey(), undefined);
  });

  it("returns trimmed delivery configuration", () => {
    process.env.AUTH_EMAIL_DELIVERY = "  resend  ";
    process.env.AUTH_EMAIL_FROM = "  TextIQ <auth@example.com>  ";
    process.env.RESEND_API_KEY = "  re_secret  ";

    assert.equal(authEmail.delivery(), "resend");
    assert.equal(authEmail.from(), "TextIQ <auth@example.com>");
    assert.equal(authEmail.resendApiKey(), "re_secret");
  });
});

// ---------------------------------------------------------------------------
// db (delegated to db-provider)
// ---------------------------------------------------------------------------

describe("db", () => {
  it("provider() defaults to sqlite when DB_PROVIDER is unset", () => {
    assert.equal(db.provider(), "sqlite");
  });

  it("provider() resolves postgres", () => {
    process.env.DB_PROVIDER = "postgres";
    assert.equal(db.provider(), "postgres");
  });

  it("url() falls back to the sqlite dev file by default", () => {
    assert.equal(db.url(), "file:./prisma/dev.db");
  });

  it("url() returns an explicit DATABASE_URL", () => {
    process.env.DATABASE_URL = "file:./custom.db";
    assert.equal(db.url(), "file:./custom.db");
  });
});

// ---------------------------------------------------------------------------
// stripe (feature-gated)
// ---------------------------------------------------------------------------

describe("stripe", () => {
  it("isConfigured() is false without a secret key", () => {
    assert.equal(stripe.isConfigured(), false);
  });

  it("isConfigured() is true when STRIPE_SECRET_KEY is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    assert.equal(stripe.isConfigured(), true);
  });

  it("secretKey() throws MissingEnvError naming the var when unset", () => {
    assert.throws(
      () => stripe.secretKey(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "STRIPE_SECRET_KEY");
        return true;
      },
    );
  });

  it("plusPriceId() throws MissingEnvError naming the var when unset", () => {
    assert.throws(
      () => stripe.plusPriceId(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "STRIPE_PLUS_PRICE_ID");
        return true;
      },
    );
  });

  it("proPriceId() throws MissingEnvError naming the var when unset", () => {
    assert.throws(
      () => stripe.proPriceId(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "STRIPE_PRO_PRICE_ID");
        return true;
      },
    );
  });

  it("required getters return their values when set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PLUS_PRICE_ID = "price_plus";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    assert.equal(stripe.secretKey(), "sk_test_123");
    assert.equal(stripe.plusPriceId(), "price_plus");
    assert.equal(stripe.proPriceId(), "price_pro");
  });

  it("webhookSecret() is optional", () => {
    assert.equal(stripe.webhookSecret(), undefined);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    assert.equal(stripe.webhookSecret(), "whsec_123");
  });
});

// ---------------------------------------------------------------------------
// azure (feature-gated, with caller-supplied defaults)
// ---------------------------------------------------------------------------

describe("azure", () => {
  it("isConfigured() requires both endpoint and api key", () => {
    assert.equal(azure.isConfigured(), false);
    process.env.AZURE_OPENAI_ENDPOINT = "https://x.openai.azure.com";
    assert.equal(azure.isConfigured(), false);
    process.env.AZURE_OPENAI_API_KEY = "key";
    assert.equal(azure.isConfigured(), true);
  });

  it("endpoint()/apiKey() are optional and trimmed", () => {
    assert.equal(azure.endpoint(), undefined);
    assert.equal(azure.apiKey(), undefined);
    process.env.AZURE_OPENAI_ENDPOINT = "  https://x.openai.azure.com  ";
    process.env.AZURE_OPENAI_API_KEY = "  key  ";
    assert.equal(azure.endpoint(), "https://x.openai.azure.com");
    assert.equal(azure.apiKey(), "key");
  });

  it("deployment()/apiVersion() return undefined so callers can default", () => {
    assert.equal(azure.deployment(), undefined);
    assert.equal(azure.apiVersion(), undefined);
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-5.5";
    process.env.AZURE_OPENAI_API_VERSION = "2024-10-21";
    assert.equal(azure.deployment(), "gpt-5.5");
    assert.equal(azure.apiVersion(), "2024-10-21");
  });
});

// ---------------------------------------------------------------------------
// google (feature-gated)
// ---------------------------------------------------------------------------

describe("google", () => {
  it("isConfigured() requires both id and secret", () => {
    assert.equal(google.isConfigured(), false);
    process.env.GOOGLE_CLIENT_ID = "id";
    assert.equal(google.isConfigured(), false);
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    assert.equal(google.isConfigured(), true);
  });

  it("isConfigured() treats empty strings as absent", () => {
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    assert.equal(google.isConfigured(), false);
  });

  it("clientId()/clientSecret() throw MissingEnvError naming the var", () => {
    assert.throws(
      () => google.clientId(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "GOOGLE_CLIENT_ID");
        return true;
      },
    );
    assert.throws(
      () => google.clientSecret(),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvError);
        assert.equal(err.variable, "GOOGLE_CLIENT_SECRET");
        return true;
      },
    );
  });

  it("clientId()/clientSecret() return values when set", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    assert.equal(google.clientId(), "id");
    assert.equal(google.clientSecret(), "secret");
  });
});

// ---------------------------------------------------------------------------
// app url (server-side accessor)
// ---------------------------------------------------------------------------

describe("app.url", () => {
  it("defaults to http://localhost:4000 when unset", () => {
    assert.equal(app.url(), "http://localhost:4000");
  });

  it("honours a custom fallback when unset", () => {
    assert.equal(app.url("http://localhost:3000"), "http://localhost:3000");
  });

  it("returns NEXT_PUBLIC_APP_URL when set, ignoring the fallback", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://textiq.example.com";
    assert.equal(
      app.url("http://localhost:3000"),
      "https://textiq.example.com",
    );
  });
});
