import assert from "node:assert/strict";
import test from "node:test";

import {
  comparePassword,
  hashPassword,
  PASSWORD_HASH_COST,
  validatePasswordChange,
  validatePasswordLength,
} from "@/lib/auth/password";
import {
  MAX_PASSWORD_UTF8_BYTES,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";

test("accepts a long-enough password that matches its confirmation", () => {
  const result = validatePasswordChange({
    newPassword: "supersecret",
    confirmPassword: "supersecret",
  });
  assert.deepEqual(result, { ok: true });
});

test("accepts a password exactly at the minimum length", () => {
  const password = "a".repeat(MIN_PASSWORD_LENGTH);
  const result = validatePasswordChange({
    newPassword: password,
    confirmPassword: password,
  });
  assert.deepEqual(result, { ok: true });
});

test("rejects a password shorter than the minimum length", () => {
  const password = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  const result = validatePasswordChange({
    newPassword: password,
    confirmPassword: password,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.ok === false ? result.message : "",
    new RegExp(`${MIN_PASSWORD_LENGTH} characters`),
  );
});

test("the length check runs before the match check", () => {
  // Both fail (too short AND mismatched) — the length message wins so the user
  // fixes the more fundamental problem first.
  const result = validatePasswordChange({
    newPassword: "short",
    confirmPassword: "different",
  });
  assert.equal(result.ok, false);
  assert.match(
    result.ok === false ? result.message : "",
    new RegExp(`${MIN_PASSWORD_LENGTH} characters`),
  );
});

test("rejects a long-enough password that does not match its confirmation", () => {
  const result = validatePasswordChange({
    newPassword: "supersecret",
    confirmPassword: "supersecre7",
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.ok === false ? result.message : "",
    "New passwords don't match.",
  );
});

test("rejects passwords that bcrypt would truncate after 72 UTF-8 bytes", () => {
  const asciiPassword = "a".repeat(MAX_PASSWORD_UTF8_BYTES + 1);
  const multibytePassword = "😀".repeat(19);

  for (const password of [asciiPassword, multibytePassword]) {
    const registrationResult = validatePasswordLength(password);
    assert.equal(registrationResult.ok, false);
    assert.match(
      registrationResult.ok === false ? registrationResult.message : "",
      /72 UTF-8 bytes/,
    );

    const changeResult = validatePasswordChange({
      newPassword: password,
      confirmPassword: password,
    });
    assert.equal(changeResult.ok, false);
    assert.match(
      changeResult.ok === false ? changeResult.message : "",
      /72 UTF-8 bytes/,
    );
  }
});

test("accepts a multibyte password exactly at bcrypt's 72-byte boundary", () => {
  const password = "😀".repeat(18);

  assert.deepEqual(validatePasswordLength(password), { ok: true });
  assert.deepEqual(
    validatePasswordChange({
      newPassword: password,
      confirmPassword: password,
    }),
    { ok: true },
  );
});

test("hashPassword and comparePassword share the centralized bcrypt cost", async () => {
  const hash = await hashPassword("supersecret");

  assert.match(hash, /^\$2[aby]\$/);
  assert.match(hash, new RegExp(`^\\$2[aby]\\$${PASSWORD_HASH_COST}\\$`));
  assert.equal(await comparePassword("supersecret", hash), true);
  assert.equal(await comparePassword("wrong-secret", hash), false);
});
