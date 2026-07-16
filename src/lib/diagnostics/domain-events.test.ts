import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildAssetOrphanContext,
  buildCommandValidationContext,
  buildMeteredUsageContext,
  buildUsageLedgerContext,
} from "./domain-events";

describe("domain telemetry event builders", () => {
  test("usage ledger context is allowlisted and redacts sensitive keys", () => {
    const context = buildUsageLedgerContext({
      keyHash: "hash-1",
      operation: "generate",
      creditCost: 3,
      status: "reserved",
      reservationVersion: 1,
      apiKey: "sk-secret",
      prompt: "draft content",
    } as never);

    assert.deepEqual(context, {
      keyHash: "hash-1",
      operation: "generate",
      creditCost: 3,
      status: "reserved",
      reservationVersion: 1,
    });
    assert.ok(!JSON.stringify(context).includes("draft content"));
    assert.ok(!JSON.stringify(context).includes("sk-secret"));
  });

  test("metered usage context carries billing operation metadata only", () => {
    const context = buildMeteredUsageContext({
      keyHash: "hash-1",
      operation: "generate",
      creditCost: 3,
      status: "captured",
      reservationVersion: 1,
      userId: "user-1",
      prompt: "draft content",
    } as never);

    assert.deepEqual(context, {
      keyHash: "hash-1",
      operation: "generate",
      creditCost: 3,
      status: "captured",
      reservationVersion: 1,
      userId: "user-1",
    });
    assert.ok(!JSON.stringify(context).includes("draft content"));
  });

  test("asset orphan context carries only safe purge metadata", () => {
    const context = buildAssetOrphanContext({
      documentId: "doc-1",
      purgedCount: 2,
      storageKey: "assets/doc-1/dead.png",
      contentJson: "SECRET CONTENT",
      payload: { text: "nested leak" },
    } as never);

    assert.equal(context.documentId, "doc-1");
    assert.equal(context.purgedCount, 2);
    assert.equal(context.storageKey, "assets/doc-1/dead.png");
    assert.ok(!JSON.stringify(context).includes("SECRET CONTENT"));
    assert.ok(!JSON.stringify(context).includes("nested leak"));
  });

  test("command validation context redacts and allowlists failure metadata", () => {
    const context = buildCommandValidationContext({
      commandId: "cmd-1",
      commandType: "deck.slide_command",
      commandSurface: "deck",
      schemaVersion: 1,
      documentId: "doc-1",
      errorCode: "invalid_command",
      token: "secret-token",
      payload: { title: "leaked title" },
    } as never);

    assert.equal(context.commandId, "cmd-1");
    assert.equal(context.commandType, "deck.slide_command");
    assert.equal(context.token, undefined);
    assert.equal(context.payload, undefined);
    assert.ok(!JSON.stringify(context).includes("leaked title"));
    assert.ok(!JSON.stringify(context).includes("secret-token"));
  });
});
