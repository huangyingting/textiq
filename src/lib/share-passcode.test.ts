import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSharePasscodeUnlockToken,
  isSharePasscodeUnlockTokenValid,
  normalizeSharePasscode,
  safeReturnPath,
  sharePasscodeCookieName,
  validateSharePasscode,
} from "./share-passcode";

test("share passcode validation trims input and enforces short-code bounds", () => {
  assert.equal(normalizeSharePasscode(" 1234 "), "1234");
  assert.deepEqual(validateSharePasscode("123"), {
    ok: false,
    message: "Passcode must be at least 4 characters.",
  });
  assert.deepEqual(validateSharePasscode("1234"), { ok: true });
});

test("share passcode unlock tokens are bound to share id and passcode hash", () => {
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "hash-a",
    secret: "secret",
    now: 0,
  });

  assert.equal(
    isSharePasscodeUnlockTokenValid({
      token,
      shareId: "share-1",
      passcodeHash: "hash-a",
      secret: "secret",
      now: 1,
    }),
    true,
  );
  assert.equal(
    isSharePasscodeUnlockTokenValid({
      token,
      shareId: "share-2",
      passcodeHash: "hash-a",
      secret: "secret",
      now: 1,
    }),
    false,
  );
  assert.equal(
    isSharePasscodeUnlockTokenValid({
      token,
      shareId: "share-1",
      passcodeHash: "hash-b",
      secret: "secret",
      now: 1,
    }),
    false,
  );
});

test("share passcode unlock tokens expire and use per-share cookie names", () => {
  const token = createSharePasscodeUnlockToken({
    shareId: "share-1",
    passcodeHash: "hash-a",
    secret: "secret",
    now: 0,
  });

  assert.equal(
    isSharePasscodeUnlockTokenValid({
      token,
      shareId: "share-1",
      passcodeHash: "hash-a",
      secret: "secret",
      now: 12 * 60 * 60 * 1000,
    }),
    false,
  );
  assert.equal(
    sharePasscodeCookieName("share-1!"),
    "textiq_share_unlock_share-1",
  );
});

test("safeReturnPath accepts allowed prefixes unchanged and falls back to /share", () => {
  const accepted: Array<[FormDataEntryValue | null, string]> = [
    ["/share/abc", "/share/abc"],
    ["/embed/doc-1", "/embed/doc-1"],
    ["/present/xyz", "/present/xyz"],
    ["/share/abc?mode=embed&foo=bar", "/share/abc?mode=embed&foo=bar"],
  ];
  for (const [input, expected] of accepted) {
    assert.equal(
      safeReturnPath(input),
      expected,
      `expected "${expected}" for input "${String(input)}"`,
    );
  }

  const fallback: Array<FormDataEntryValue | null> = [
    "/app/evil",
    "/shares/fake",
    "//evil.example/x",
    "https://evil.example",
    "javascript:alert(1)",
    "",
    null,
  ];
  for (const input of fallback) {
    assert.equal(
      safeReturnPath(input),
      "/share",
      `expected "/share" fallback for input "${String(input)}"`,
    );
  }
});
