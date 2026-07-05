import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateShareAccess,
  evaluateShareAccessDecision,
  isShareAccessAllowed,
  shareAccessDecisionToAccessDecision,
  toShareAccessInput,
  type ShareAccessInput,
  type ShareMode,
} from "./share-access";

const NOW = new Date("2026-06-21T00:00:00Z");
const SHARE_ID = "abc123XYZ789";

/** Builds a fully-valid, allowed share-access input; override per case. */
function input(overrides: Partial<ShareAccessInput> = {}): ShareAccessInput {
  return {
    requestedShareId: SHARE_ID,
    shareId: SHARE_ID,
    isShared: true,
    deletedAt: null,
    expiresAt: null,
    embedEnabled: true,
    presentEnabled: true,
    mode: "view",
    now: NOW,
    ...overrides,
  };
}

test("evaluateShareAccess: active link → allow (view)", () => {
  const decision = evaluateShareAccess(input());
  assert.deepEqual(decision, { allow: true });
});

test("evaluateShareAccess: optional passcode allows unprotected links", () => {
  assert.deepEqual(evaluateShareAccess(input({ passcodeHash: null })), {
    allow: true,
  });
});

test("evaluateShareAccess: passcode-protected link requires unlock", () => {
  assert.deepEqual(evaluateShareAccess(input({ passcodeHash: "hash" })), {
    allow: false,
    reason: "passcode-required",
  });
  assert.deepEqual(
    evaluateShareAccess(
      input({ passcodeHash: "hash", passcodeUnlocked: true }),
    ),
    { allow: true },
  );
});

test("evaluateShareAccess: regenerated links deny before passcode challenge", () => {
  assert.deepEqual(
    evaluateShareAccess(
      input({
        shareId: "newRotatedId99",
        requestedShareId: SHARE_ID,
        passcodeHash: "hash",
      }),
    ),
    { allow: false, reason: "revoked" },
  );
});

test("evaluateShareAccess: active link → allow (embed and present too)", () => {
  assert.equal(isShareAccessAllowed(input({ mode: "embed" })), true);
  assert.equal(isShareAccessAllowed(input({ mode: "present" })), true);
});

test("evaluateShareAccess: disabled (not shared) → deny", () => {
  const decision = evaluateShareAccess(input({ isShared: false }));
  assert.deepEqual(decision, { allow: false, reason: "not-shared" });
});

test("share access taxonomy maps public denials to privacy 404", () => {
  const decision = shareAccessDecisionToAccessDecision("view", {
    allow: false,
    reason: "not-shared",
  });
  assert.deepEqual(decision, {
    allow: false,
    resource: { kind: "share" },
    capability: "view",
    reason: "share-not-enabled",
    status: 404,
    safeMessage: "Shared document not found.",
    concealResource: true,
  });
});

test("evaluateShareAccessDecision uses the same mapping for view/embed/present", () => {
  assert.deepEqual(evaluateShareAccessDecision(input({ mode: "view" })), {
    allow: true,
    resource: { kind: "share" },
    capability: "view",
  });
  assert.deepEqual(
    evaluateShareAccessDecision(input({ mode: "embed", embedEnabled: false })),
    {
      allow: false,
      resource: { kind: "share" },
      capability: "embed",
      reason: "mode-disabled",
      status: 404,
      safeMessage: "Shared document not found.",
      concealResource: true,
    },
  );
  assert.deepEqual(
    evaluateShareAccessDecision(
      input({ mode: "present", presentEnabled: false }),
    ),
    {
      allow: false,
      resource: { kind: "share" },
      capability: "present",
      reason: "mode-disabled",
      status: 404,
      safeMessage: "Shared document not found.",
      concealResource: true,
    },
  );
  assert.deepEqual(
    evaluateShareAccessDecision(input({ passcodeHash: "hash" })),
    {
      allow: false,
      resource: { kind: "share" },
      capability: "view",
      reason: "passcode-required",
      status: 403,
      safeMessage: "Enter the share passcode to continue.",
      concealResource: false,
    },
  );
});

test("evaluateShareAccess: cleared shareId → deny as not-shared", () => {
  const decision = evaluateShareAccess(
    input({ shareId: null, requestedShareId: SHARE_ID }),
  );
  assert.deepEqual(decision, { allow: false, reason: "not-shared" });
});

test("evaluateShareAccess: regenerated link (old id no longer matches) → deny", () => {
  // The link was rotated: the stored shareId is now different from the one in
  // the old URL the visitor is using.
  const decision = evaluateShareAccess(
    input({ shareId: "newRotatedId99", requestedShareId: SHARE_ID }),
  );
  assert.deepEqual(decision, { allow: false, reason: "revoked" });
});

test("evaluateShareAccess: soft-deleted document → deny", () => {
  const decision = evaluateShareAccess(
    input({ deletedAt: new Date("2026-06-20T00:00:00Z") }),
  );
  assert.deepEqual(decision, { allow: false, reason: "deleted" });
});

test("evaluateShareAccess: expired link (expiry in the past) → deny", () => {
  const decision = evaluateShareAccess(
    input({ expiresAt: new Date(NOW.getTime() - 1000) }),
  );
  assert.deepEqual(decision, { allow: false, reason: "expired" });
});

test("evaluateShareAccess: expiry exactly at now → deny (inclusive)", () => {
  const decision = evaluateShareAccess(input({ expiresAt: NOW }));
  assert.deepEqual(decision, { allow: false, reason: "expired" });
});

test("evaluateShareAccess: expiry in the future → allow", () => {
  const decision = evaluateShareAccess(
    input({ expiresAt: new Date(NOW.getTime() + 1000) }),
  );
  assert.deepEqual(decision, { allow: true });
});

test("evaluateShareAccess: embed disallowed → deny embed but still allow view/present", () => {
  assert.deepEqual(
    evaluateShareAccess(input({ mode: "embed", embedEnabled: false })),
    {
      allow: false,
      reason: "embed-disabled",
    },
  );
  assert.equal(
    isShareAccessAllowed(input({ mode: "view", embedEnabled: false })),
    true,
  );
  assert.equal(
    isShareAccessAllowed(input({ mode: "present", embedEnabled: false })),
    true,
  );
});

test("evaluateShareAccess: present disallowed → deny present but still allow view/embed", () => {
  assert.deepEqual(
    evaluateShareAccess(input({ mode: "present", presentEnabled: false })),
    { allow: false, reason: "present-disabled" },
  );
  assert.equal(
    isShareAccessAllowed(input({ mode: "view", presentEnabled: false })),
    true,
  );
  assert.equal(
    isShareAccessAllowed(input({ mode: "embed", presentEnabled: false })),
    true,
  );
});

test("evaluateShareAccess: deny ordering — not-shared wins over expiry/mode", () => {
  const decision = evaluateShareAccess(
    input({
      isShared: false,
      expiresAt: new Date(NOW.getTime() - 1000),
      mode: "embed",
      embedEnabled: false,
    }),
  );
  assert.deepEqual(decision, { allow: false, reason: "not-shared" });
});

test("evaluateShareAccess: deny ordering — expiry wins over disabled mode", () => {
  const decision = evaluateShareAccess(
    input({
      expiresAt: new Date(NOW.getTime() - 1000),
      mode: "embed",
      embedEnabled: false,
    }),
  );
  assert.deepEqual(decision, { allow: false, reason: "expired" });
});

test("evaluateShareAccess: defaults to current time when now omitted", () => {
  // Expiry far in the past should deny without an injected clock.
  const decision = evaluateShareAccess({
    requestedShareId: SHARE_ID,
    shareId: SHARE_ID,
    isShared: true,
    deletedAt: null,
    expiresAt: new Date("2000-01-01T00:00:00Z"),
    embedEnabled: true,
    presentEnabled: true,
    mode: "view",
  });
  assert.deepEqual(decision, { allow: false, reason: "expired" });
});

test("toShareAccessInput: maps a selected document row to the policy input", () => {
  const modes: ShareMode[] = ["view", "embed", "present"];
  for (const mode of modes) {
    const mapped = toShareAccessInput(
      {
        shareId: SHARE_ID,
        isShared: true,
        deletedAt: null,
        shareExpiresAt: null,
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
        sharePasscodeHash: "hash",
      },
      SHARE_ID,
      mode,
      NOW,
      true,
    );
    assert.equal(mapped.requestedShareId, SHARE_ID);
    assert.equal(mapped.shareId, SHARE_ID);
    assert.equal(mapped.presentEnabled, false);
    assert.equal(mapped.embedEnabled, true);
    assert.equal(mapped.passcodeHash, "hash");
    assert.equal(mapped.passcodeUnlocked, true);
    assert.equal(mapped.mode, mode);
    assert.equal(mapped.now, NOW);
  }

  // And the mapped input drives the same decision as a hand-built one.
  const denied = evaluateShareAccess(
    toShareAccessInput(
      {
        shareId: SHARE_ID,
        isShared: true,
        deletedAt: null,
        shareExpiresAt: null,
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
      },
      SHARE_ID,
      "present",
      NOW,
    ),
  );
  assert.deepEqual(denied, { allow: false, reason: "present-disabled" });
});
