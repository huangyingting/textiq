import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessDecisionToApiResponse,
  accessDecisionToDiagnostic,
  accessDecisionToPlainTextApiResponse,
  accessDecisionToServerActionError,
  assertAccessDecisionForServerAction,
  assertAccessDecisionOrNotFound,
} from "./adapters";
import { allowAccess, denyAccess } from "./taxonomy";

const ALLOW = allowAccess({
  resource: { kind: "document" },
  capability: "view",
});

const PRIVACY_DENY = denyAccess({
  resource: { kind: "document" },
  capability: "view",
  reason: "resource-not-found",
  status: 404,
  safeMessage: "Document not found.",
  concealResource: true,
});

const FORBID = denyAccess({
  resource: { kind: "workspace" },
  capability: "manage",
  reason: "insufficient-capability",
  status: 403,
  safeMessage: "Only the workspace owner may perform this action.",
  concealResource: false,
});

const UNAUTH = denyAccess({
  resource: { kind: "document" },
  capability: "view",
  reason: "unauthenticated",
  status: 401,
  safeMessage: "Authentication required.",
  concealResource: false,
});

test("server-action adapter returns null for allow and safe errors for deny", () => {
  assert.equal(accessDecisionToServerActionError(ALLOW), null);
  const error = accessDecisionToServerActionError(PRIVACY_DENY);
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Document not found.");

  assert.throws(
    () => assertAccessDecisionForServerAction(FORBID),
    /Only the workspace owner/,
  );
});

test("notFound adapter calls the provided notFound function only for deny", () => {
  assert.doesNotThrow(() =>
    assertAccessDecisionOrNotFound(ALLOW, () => {
      throw new Error("unexpected");
    }),
  );
  assert.throws(
    () =>
      assertAccessDecisionOrNotFound(PRIVACY_DENY, () => {
        throw new Error("NEXT_NOT_FOUND");
      }),
    /NEXT_NOT_FOUND/,
  );
});

test("API adapter preserves access-decision statuses and messages", async () => {
  const denied = accessDecisionToApiResponse(PRIVACY_DENY);
  assert.equal(denied?.status, 404);
  assert.deepEqual(await denied?.json(), {
    error: "Document not found.",
    code: "NOT_FOUND",
  });

  const forbidden = accessDecisionToApiResponse(FORBID);
  assert.equal(forbidden?.status, 403);
  assert.deepEqual(await forbidden?.json(), {
    error: "Only the workspace owner may perform this action.",
    code: "FORBIDDEN",
  });

  const unauthenticated = accessDecisionToApiResponse(UNAUTH);
  assert.equal(unauthenticated?.status, 401);
  assert.deepEqual(await unauthenticated?.json(), {
    error: "Authentication required.",
    code: "UNAUTHORIZED",
  });
});

test("plain-text API adapter preserves binary-route privacy bodies", async () => {
  const response = accessDecisionToPlainTextApiResponse(PRIVACY_DENY);
  assert.equal(response?.status, 404);
  assert.equal(await response?.text(), "Not found");
});

test("diagnostic adapter omits resource and subject identifiers", () => {
  assert.deepEqual(accessDecisionToDiagnostic(ALLOW), {
    outcome: "allow",
    resource: "document",
    capability: "view",
  });

  assert.deepEqual(accessDecisionToDiagnostic(FORBID), {
    outcome: "deny",
    resource: "workspace",
    capability: "manage",
    reason: "insufficient-capability",
    status: 403,
    concealResource: false,
  });
});
