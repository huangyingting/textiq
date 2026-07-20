import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { POST, runtime } from "./route";

const STRIPE_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;

function makeRequest(
  body = "{}",
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    body,
    headers,
  });
}

async function withStripeEnv(
  values: Partial<Record<(typeof STRIPE_ENV_KEYS)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const saved = Object.fromEntries(
    STRIPE_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of STRIPE_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const key of STRIPE_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("billing webhook route opts into the Node runtime for Stripe", () => {
  assert.equal(runtime, "nodejs");
});

test("POST returns ok when Stripe billing is not configured", async () => {
  await withStripeEnv({}, async () => {
    const response = await POST(makeRequest());
    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), { message: "ok" });
  });
});

test("POST returns validation error when the Stripe signature is missing", async () => {
  await withStripeEnv(
    { STRIPE_SECRET_KEY: "sk_test_ci_placeholder" },
    async () => {
      const response = await POST(makeRequest());
      assert.strictEqual(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Missing stripe-signature header",
        code: "VALIDATION_ERROR",
      });
    },
  );
});

test("POST returns provider status when the webhook secret is missing", async () => {
  await withStripeEnv(
    { STRIPE_SECRET_KEY: "sk_test_ci_placeholder" },
    async () => {
      const response = await POST(
        makeRequest("{}", { "stripe-signature": "test-signature" }),
      );
      assert.strictEqual(response.status, 500);
      assert.deepEqual(await response.json(), {
        message: "STRIPE_WEBHOOK_SECRET not configured",
      });
    },
  );
});

test("POST wraps webhook handler failures in the canonical server error", async () => {
  await withStripeEnv(
    {
      STRIPE_SECRET_KEY: "sk_test_ci_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_test_placeholder",
    },
    async () => {
      const originalConsoleError = console.error;
      const errorLogs: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };
      try {
        const response = await POST(
          makeRequest("{}", { "stripe-signature": "test-signature" }),
        );
        assert.strictEqual(response.status, 500);
        assert.deepEqual(await response.json(), {
          error: "Webhook handler failed.",
          code: "SERVER_ERROR",
        });
      } finally {
        console.error = originalConsoleError;
      }

      assert.equal(errorLogs.length, 1);
      const [line] = errorLogs[0] ?? [];
      assert.equal(typeof line, "string");
      const record = JSON.parse(line as string) as {
        level?: string;
        scope?: string;
        message?: string;
      };
      assert.equal(record.level, "error");
      assert.equal(record.scope, "billing.webhook.handler");
      assert.equal(
        record.message,
        "The `stripe` package is not installed. Run `npm install stripe` to enable Stripe billing.",
      );
    },
  );
});
