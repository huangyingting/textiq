/**
 * Direct contract coverage for `@/lib/auth/form-state` (issue #1927).
 *
 * This module's only runtime surface is the two `initial*State` constants;
 * everything else is a discriminated-union type. The tests below pin the
 * exact shape of the initial states (so a stray extra field or renamed
 * status literal fails loudly) and exercise every variant of each union
 * through an exhaustive `switch` — a change that removes, renames, or drops
 * a required field from a variant fails to compile, and the runtime
 * assertions confirm the fields actually round-trip through plain objects
 * (e.g. after JSON transport across a server action boundary).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  initialForgotPasswordState,
  initialResetPasswordState,
  type ForgotPasswordState,
  type ResetPasswordState,
} from "./form-state";

function describeForgotPasswordState(state: ForgotPasswordState): string {
  switch (state.status) {
    case "idle":
      return "idle";
    case "sent":
      return `sent:${state.message}`;
    case "error":
      return `error:${state.message}`;
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled status: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function describeResetPasswordState(state: ResetPasswordState): string {
  switch (state.status) {
    case "idle":
      return "idle";
    case "success":
      return "success";
    case "error":
      return `error:${state.message}`;
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled status: ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe("initialForgotPasswordState", () => {
  test("is an idle state with no extra fields", () => {
    assert.deepEqual(initialForgotPasswordState, { status: "idle" });
    assert.deepEqual(Object.keys(initialForgotPasswordState), ["status"]);
  });

  test("round-trips through JSON unchanged", () => {
    const revived = JSON.parse(
      JSON.stringify(initialForgotPasswordState),
    ) as ForgotPasswordState;
    assert.deepEqual(revived, initialForgotPasswordState);
  });
});

describe("initialResetPasswordState", () => {
  test("is an idle state with no extra fields", () => {
    assert.deepEqual(initialResetPasswordState, { status: "idle" });
    assert.deepEqual(Object.keys(initialResetPasswordState), ["status"]);
  });

  test("round-trips through JSON unchanged", () => {
    const revived = JSON.parse(
      JSON.stringify(initialResetPasswordState),
    ) as ResetPasswordState;
    assert.deepEqual(revived, initialResetPasswordState);
  });
});

describe("ForgotPasswordState variants", () => {
  test("idle carries no message", () => {
    assert.equal(describeForgotPasswordState({ status: "idle" }), "idle");
  });

  test("sent carries the generic confirmation message", () => {
    assert.equal(
      describeForgotPasswordState({
        status: "sent",
        message: "If an account exists, we sent a link.",
      }),
      "sent:If an account exists, we sent a link.",
    );
  });

  test("error carries a user-facing message", () => {
    assert.equal(
      describeForgotPasswordState({
        status: "error",
        message: "Too many attempts. Try again later.",
      }),
      "error:Too many attempts. Try again later.",
    );
  });
});

describe("ResetPasswordState variants", () => {
  test("idle carries no message", () => {
    assert.equal(describeResetPasswordState({ status: "idle" }), "idle");
  });

  test("success carries no message", () => {
    assert.equal(describeResetPasswordState({ status: "success" }), "success");
  });

  test("error carries a user-facing message", () => {
    assert.equal(
      describeResetPasswordState({
        status: "error",
        message: "This reset link is invalid or has expired.",
      }),
      "error:This reset link is invalid or has expired.",
    );
  });
});
