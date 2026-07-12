/**
 * Behavioral tests for `buildPublicAttribution` (#1906).
 *
 * Covers the owner-name fallback and the plan-gated attribution badge that
 * `shouldShowAttribution` (already unit-tested in
 * `src/lib/billing/attribution.test.ts`) delegates to, so the public-render
 * boundary's own wiring — not just the underlying plan rule — is asserted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicAttribution } from "./attribution";

test("buildPublicAttribution uses the owner name when present", () => {
  const result = buildPublicAttribution({ name: "Ava Chen", plan: "free" });
  assert.equal(result.ownerName, "Ava Chen");
});

test("buildPublicAttribution falls back to a generic label when name is null", () => {
  const result = buildPublicAttribution({ name: null, plan: "free" });
  assert.equal(result.ownerName, "Document owner");
});

test("buildPublicAttribution falls back to a generic label when name is empty", () => {
  const result = buildPublicAttribution({ name: "", plan: "free" });
  assert.equal(result.ownerName, "Document owner");
});

test("buildPublicAttribution shows the badge for a free-plan owner", () => {
  const result = buildPublicAttribution({ name: "Ava", plan: "free" });
  assert.equal(result.showAttribution, true);
});

test("buildPublicAttribution hides the badge for plus/pro owners with watermark removal", () => {
  assert.equal(
    buildPublicAttribution({ name: "Ava", plan: "plus" }).showAttribution,
    false,
  );
  assert.equal(
    buildPublicAttribution({ name: "Ava", plan: "pro" }).showAttribution,
    false,
  );
});

test("buildPublicAttribution fails open and shows the badge for an unrecognised plan", () => {
  const result = buildPublicAttribution({ name: "Ava", plan: "enterprise" });
  assert.equal(result.showAttribution, true);
});
