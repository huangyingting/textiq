import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmailVerificationUrl,
  buildPasswordResetUrl,
  configureAuthEmailDeliveryPort,
  deliverAuthEmail,
  deliverPasswordResetEmail,
  deliverVerificationEmail,
  type AuthEmailMessage,
} from "@/lib/auth/email";

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

test("auth email URL builders use the runtime app URL surface", () => {
  withEnv("NEXT_PUBLIC_APP_URL", "https://textiq.example/", () => {
    assert.equal(
      buildPasswordResetUrl("raw token"),
      "https://textiq.example/reset-password?token=raw%20token",
    );
    assert.equal(
      buildEmailVerificationUrl("verify/token"),
      "https://textiq.example/verify-email/verify%2Ftoken",
    );
  });
});

test("auth email delivery port receives concrete reset and verification messages", async () => {
  const sent: AuthEmailMessage[] = [];
  configureAuthEmailDeliveryPort({
    async send(message) {
      sent.push(message);
    },
  });

  try {
    await deliverAuthEmail({
      kind: "password-reset",
      to: "ada@example.com",
      resetUrl: "https://textiq.example/reset-password?token=reset",
    });
    await deliverAuthEmail({
      kind: "email-verification",
      to: "ada@example.com",
      verifyUrl: "https://textiq.example/verify-email/verify",
    });
  } finally {
    configureAuthEmailDeliveryPort(null);
  }

  assert.deepEqual(
    sent.map((message) => message.kind),
    ["password-reset", "email-verification"],
  );
});

test("auth email wrappers send concrete reset and verification messages", async () => {
  const sent: AuthEmailMessage[] = [];
  configureAuthEmailDeliveryPort({
    async send(message) {
      sent.push(message);
    },
  });

  try {
    await deliverPasswordResetEmail({
      to: "ada@example.com",
      resetUrl: "https://textiq.example/reset-password?token=reset",
    });
    await deliverVerificationEmail({
      to: "ada@example.com",
      verifyUrl: "https://textiq.example/verify-email/verify",
    });
  } finally {
    configureAuthEmailDeliveryPort(null);
  }

  assert.deepEqual(
    sent.map((message) => message.kind),
    ["password-reset", "email-verification"],
  );
});

test("development fallback logs reset and verification links", async () => {
  configureAuthEmailDeliveryPort(null);
  const previousNodeEnv = process.env.NODE_ENV;
  const originalInfo = console.info;
  const lines: string[] = [];
  const env = process.env as Record<string, string | undefined>;

  env.NODE_ENV = "development";
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    await deliverAuthEmail({
      kind: "password-reset",
      to: "ada@example.com",
      resetUrl: "https://textiq.example/reset-password?token=reset",
    });
    await deliverAuthEmail({
      kind: "email-verification",
      to: "ada@example.com",
      verifyUrl: "https://textiq.example/verify-email/verify",
    });
  } finally {
    console.info = originalInfo;
    if (previousNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = previousNodeEnv;
    }
  }

  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[password-reset\]/);
  assert.match(lines[1], /\[email-verification\]/);
});

test("production fallback never logs live auth links", async () => {
  configureAuthEmailDeliveryPort(null);
  const previousNodeEnv = process.env.NODE_ENV;
  const originalInfo = console.info;
  const originalError = console.error;
  const lines: string[] = [];
  const env = process.env as Record<string, string | undefined>;

  env.NODE_ENV = "production";
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    await assert.rejects(
      () =>
        deliverAuthEmail({
          kind: "password-reset",
          to: "ada@example.com",
          resetUrl: "https://textiq.example/reset-password?token=secret-reset",
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal(
          error instanceof Error
            ? error.message.includes("secret-reset")
            : false,
          false,
        );
        assert.equal(
          error instanceof Error
            ? error.message.includes("/reset-password")
            : false,
          false,
        );
        return true;
      },
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    if (previousNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = previousNodeEnv;
    }
  }

  assert.ok(lines.length > 0);
  assert.equal(
    lines.some((line) => line.includes("secret-reset")),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes("/reset-password")),
    false,
  );
});
