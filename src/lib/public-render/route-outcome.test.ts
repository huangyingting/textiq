import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adaptPublicRouteOutcome,
  publicRoutePasscodeErrorFromParam,
} from "./route-outcome";
import {
  buildDeck,
  buildMinimalThemePackage,
} from "@/test/builders/presentation-deck";

test("publicRoutePasscodeErrorFromParam only accepts invalid/limited", () => {
  assert.equal(publicRoutePasscodeErrorFromParam("invalid"), "invalid");
  assert.equal(publicRoutePasscodeErrorFromParam("limited"), "limited");
  assert.equal(publicRoutePasscodeErrorFromParam("other"), undefined);
  assert.equal(publicRoutePasscodeErrorFromParam(undefined), undefined);
});

test("adaptPublicRouteOutcome returns resolved result for matching successful projection", () => {
  const resolved = adaptPublicRouteOutcome(
    {
      ok: true,
      mode: "view",
      projection: "document",
      shareId: "resolved-share",
      document: {
        id: "doc-1",
        title: "Doc",
        contentJson: {},
        ownerName: "Owner",
        showAttribution: true,
      },
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "view",
      },
    },
    "document",
    "raw-share",
    undefined,
  );

  assert.equal(resolved.kind, "resolved");
  if (resolved.kind !== "resolved") {
    throw new Error("Expected resolved outcome");
  }
  assert.equal(resolved.result.document.id, "doc-1");
});

test("adaptPublicRouteOutcome returns passcode gate for passcode-required denials", () => {
  const gated = adaptPublicRouteOutcome(
    {
      ok: false,
      mode: "embed",
      projection: "document",
      shareId: "",
      decision: {
        allow: false,
        resource: { kind: "share" },
        capability: "embed",
        reason: "passcode-required",
        status: 403,
        safeMessage: "Enter the share passcode to continue.",
        concealResource: false,
      },
    },
    "document",
    "raw-share",
    "invalid",
  );

  assert.deepEqual(gated, {
    kind: "passcode-required",
    gate: { shareId: "raw-share", error: "invalid" },
  });
});

test("adaptPublicRouteOutcome returns not-found for non-passcode denials and projection mismatches", () => {
  const denied = adaptPublicRouteOutcome(
    {
      ok: false,
      mode: "present",
      projection: "presentation",
      shareId: "resolved-share",
      decision: {
        allow: false,
        resource: { kind: "share" },
        capability: "present",
        reason: "share-revoked",
        status: 404,
        safeMessage: "Shared document not found.",
        concealResource: true,
      },
    },
    "presentation",
    "raw-share",
    "limited",
  );
  assert.deepEqual(denied, { kind: "not-found" });

  const mismatch = adaptPublicRouteOutcome(
    {
      ok: true,
      mode: "present",
      projection: "presentation",
      shareId: "resolved-share",
      presentation: {
        title: "Deck",
        deck: buildDeck(),
        themePackage: buildMinimalThemePackage("neutral"),
        visuals: {},
        diagnostics: [],
        attribution: {
          ownerName: "Owner",
          showAttribution: true,
        },
      },
      decision: {
        allow: true,
        resource: { kind: "share" },
        capability: "present",
      },
    },
    "document",
    "raw-share",
    undefined,
  );
  assert.deepEqual(mismatch, { kind: "not-found" });
});
