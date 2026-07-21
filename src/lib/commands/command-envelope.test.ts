import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURRENT_COMMAND_SCHEMA_VERSION,
  acceptDeckCommandEnvelope,
  adaptSlideCommandResult,
  isStringArray,
  makeSideEffects,
  pushUnknownKeyErrors,
  uniqueStrings,
  validateCommandEnvelopeStructure,
  validateTarget,
  validateCommandEnvelope,
  type CommandEnvelope,
} from "@/lib/commands/command-envelope";
import type { SlideCommand } from "../document/deck-kernel/slide-commands";
import { executeCommand } from "../document/deck-kernel/slide-commands";
import { makeDeckFromIds } from "@/test/builders/deck";

const ACTOR = { id: "user-1", sessionId: "session-1" };
const BASE_TIMESTAMP = "2026-06-23T00:00:00.000Z";

function commandId(suffix: string): string {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

const makeDeck = makeDeckFromIds;

function invalidEnvelope(value: unknown): CommandEnvelope {
  return value as unknown as CommandEnvelope;
}

function invalidSlideCommand(value: unknown): SlideCommand {
  return value as unknown as SlideCommand;
}

test("validateCommandEnvelope accepts a valid visual envelope", () => {
  const envelope: CommandEnvelope = {
    id: commandId("1"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.set_style",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: {
      surface: "visual",
      documentId: "doc-1",
      visualId: "vis-1",
      expectedRevision: "rev-1",
    },
    payload: {
      op: "visual.set_style",
      patch: { background: "#111111", fontWeight: 700 },
    },
    coalesceKey: "visual-style:vis-1",
    source: "user",
  };

  const validation = validateCommandEnvelope(envelope);
  assert.equal(validation.valid, true);
  assert.deepEqual(
    makeSideEffects(
      { kind: "render_invalidation", visualId: "vis-1" },
      { kind: "render_invalidation", visualId: "vis-1" },
      { kind: "visual_mirror_rebuild", visualId: "vis-1" },
    ),
    [
      { kind: "render_invalidation", visualId: "vis-1" },
      { kind: "visual_mirror_rebuild", visualId: "vis-1" },
    ],
  );
});

test("validateCommandEnvelope requires strict ISO-8601 timestamps", () => {
  const base = {
    id: commandId("a1"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "comment.update",
    actor: ACTOR,
    target: { surface: "comment" as const, commentId: "comment-1" },
    payload: { text: "Looks good" },
  };

  for (const timestamp of [
    "2026-06-23T00:00:00.000Z",
    "2026-07-21T04:54:59.108+00:00",
  ]) {
    const validation = validateCommandEnvelope(
      invalidEnvelope({ ...base, timestamp }),
    );
    assert.equal(validation.valid, true, timestamp);
  }

  for (const timestamp of [
    "June 23, 2026",
    "2026-06-23",
    "2026-02-30T00:00:00Z",
  ]) {
    const validation = validateCommandEnvelope(
      invalidEnvelope({
        ...base,
        id: commandId(`b${timestamp.length}`),
        timestamp,
      }),
    );
    assert.equal(validation.valid, false, timestamp);
    assert.ok(
      validation.errors.includes("timestamp must be a valid ISO-8601 string."),
      timestamp,
    );
  }
});

test("validateCommandEnvelope reports invalid ids, targets, and payload mismatches", () => {
  const invalid = invalidEnvelope({
    id: "not-a-uuid",
    schemaVersion: 0,
    type: "visual.set_style",
    timestamp: "not-a-date",
    actor: { id: "" },
    target: { surface: "visual" },
    payload: {
      op: "visual.set_node_style",
      nodeId: "n1",
      field: "fill",
      value: 42,
    },
  });

  const validation = validateCommandEnvelope(invalid);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("UUID v4")));
  assert.ok(validation.errors.some((error) => error.includes("schemaVersion")));
  assert.ok(validation.errors.some((error) => error.includes("timestamp")));
  assert.ok(validation.errors.some((error) => error.includes("actor.id")));
  assert.ok(validation.errors.some((error) => error.includes("visualId")));
  assert.ok(
    validation.errors.some((error) => error.includes("payload.op must match")),
  );
});

test("envelope core helpers reject malformed targets and optional fields", () => {
  assert.equal(isStringArray(["alpha", "beta"]), true);
  assert.equal(isStringArray(["alpha", 1]), false);
  assert.deepEqual(uniqueStrings(["alpha", "", "alpha", "beta"]), [
    "alpha",
    "beta",
  ]);
  assert.deepEqual(uniqueStrings(undefined), []);

  const unknownKeyErrors: string[] = [];
  pushUnknownKeyErrors(
    { supported: true, extra: true },
    ["supported"],
    "payload",
    unknownKeyErrors,
  );
  assert.deepEqual(unknownKeyErrors, ["payload.extra is not supported."]);

  assert.deepEqual(validateTarget(null), {
    errors: ["target must be an object."],
  });
  assert.deepEqual(validateTarget({ surface: "unsupported" }), {
    errors: [
      "target.surface must be one of: document, visual, deck, asset, comment, source-ref.",
    ],
  });

  for (const [surface, requiredError] of [
    ["document", "target.documentId is required for document commands."],
    ["visual", "target.visualId is required for visual commands."],
    ["deck", "target.documentId is required for deck commands."],
    ["asset", "target.assetId is required for asset commands."],
    ["comment", "target.commentId is required for comment commands."],
    ["source-ref", "target.sourceRefId is required for source-ref commands."],
  ] as const) {
    const validation = validateTarget({
      surface,
      documentId: "",
      visualId: "",
      assetId: "",
      commentId: "",
      sourceRefId: "",
      unexpected: true,
    });
    assert.equal(validation.surface, surface);
    assert.ok(validation.errors.includes(requiredError));
    assert.ok(
      validation.errors.some((error) =>
        error.includes("must be a non-empty string when provided"),
      ),
    );
    assert.ok(
      validation.errors.includes("target.unexpected is not supported."),
    );
  }
});

test("envelope structure validation covers non-object and optional field errors", () => {
  assert.deepEqual(validateCommandEnvelopeStructure(null as never), {
    valid: false,
    errors: ["Command envelope must be an object."],
  });
  assert.deepEqual(validateCommandEnvelopeStructure("bad" as never), {
    valid: false,
    errors: ["Command envelope must be an object."],
  });

  const validation = validateCommandEnvelopeStructure(
    invalidEnvelope({
      id: commandId("7"),
      schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION + 1,
      type: "UPDATE_SLIDE_TITLE",
      timestamp: BASE_TIMESTAMP,
      actor: { id: "actor-1", sessionId: "" },
      target: { surface: "deck", documentId: "doc-1" },
      payload: undefined,
      coalesceKey: "",
      source: "manual",
    }),
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("schemaVersion")));
  assert.ok(validation.errors.some((error) => error.includes("sessionId")));
  assert.ok(validation.errors.some((error) => error.includes("payload")));
  assert.ok(validation.errors.some((error) => error.includes("coalesceKey")));
  assert.ok(validation.errors.some((error) => error.includes("source")));

  const missingActorAndPayload = validateCommandEnvelopeStructure(
    invalidEnvelope({
      id: commandId("8"),
      schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
      type: "deck.slide_command",
      timestamp: BASE_TIMESTAMP,
      actor: null,
      target: { surface: "deck", documentId: "doc-1" },
    }),
  );

  assert.equal(missingActorAndPayload.valid, false);
  assert.ok(missingActorAndPayload.errors.includes("actor must be an object."));
  assert.ok(missingActorAndPayload.errors.includes("payload must be present."));
});

function commentEnvelope(payload: unknown, suffix: string): CommandEnvelope {
  return invalidEnvelope({
    id: commandId(suffix),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "comment.update",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "comment", commentId: "comment-1" },
    payload,
    source: "user",
  });
}

test("command envelope validation accepts JSON-safe payloads for generic surfaces", () => {
  const validation = validateCommandEnvelope(
    commentEnvelope(
      {
        text: "Looks good",
        tags: ["review", "resolved"],
        pinned: false,
        count: 1,
        metadata: null,
      },
      "10",
    ),
  );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("envelope structure validation rejects non-JSON payload values", () => {
  const cyclic: Record<string, unknown> = { text: "cycle" };
  cyclic.self = cyclic;

  const cases: Array<[string, unknown, string]> = [
    ["function", () => undefined, "function"],
    ["symbol", Symbol("payload"), "symbol"],
    ["bigint", BigInt(1), "bigint"],
    ["nested undefined", { nested: { value: undefined } }, "undefined"],
    ["array undefined", [undefined], "undefined"],
    ["cyclic object", cyclic, "cycle"],
  ];

  for (const [index, [label, payload, expectedError]] of cases.entries()) {
    const validation = validateCommandEnvelopeStructure(
      commentEnvelope(payload, `b${index}`),
    );

    assert.equal(validation.valid, false, label);
    assert.ok(
      validation.errors.some(
        (error) =>
          error.includes("payload must be JSON-safe") &&
          error.includes(expectedError),
      ),
      label,
    );
  }
});

test("validateCommandEnvelope accepts the new edge flip/toggle + label ops", () => {
  const base = {
    id: commandId("4"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "visual" as const, visualId: "vis-3" },
    source: "user" as const,
  };

  const payloads = [
    { op: "visual.flip_edge", edgeId: "e1" },
    { op: "visual.toggle_edge_directed", edgeId: "e1" },
    { op: "visual.toggle_edge_style", edgeId: "e1" },
    { op: "visual.set_edge_label", edgeId: "e1", label: "Yes" },
  ] as const;

  for (const payload of payloads) {
    const envelope = invalidEnvelope({
      ...base,
      type: payload.op,
      payload,
    });
    const validation = validateCommandEnvelope(envelope);
    assert.equal(validation.valid, true, `${payload.op} should validate`);
  }
});

test("validateCommandEnvelope rejects edge ops with a missing/blank edgeId", () => {
  const flip = invalidEnvelope({
    id: commandId("5"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.flip_edge",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "visual", visualId: "vis-3" },
    payload: { op: "visual.flip_edge", edgeId: "" },
    source: "user",
  });

  const flipValidation = validateCommandEnvelope(flip);
  assert.equal(flipValidation.valid, false);
  assert.ok(
    flipValidation.errors.some((error) => error.includes("payload.edgeId")),
  );

  const label = invalidEnvelope({
    id: commandId("6"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.set_edge_label",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "visual", visualId: "vis-3" },
    payload: { op: "visual.set_edge_label", edgeId: "e1", label: 7 },
    source: "user",
  });

  const labelValidation = validateCommandEnvelope(label);
  assert.equal(labelValidation.valid, false);
  assert.ok(
    labelValidation.errors.some((error) => error.includes("payload.label")),
  );
});

test("validateCommandEnvelope validates add_edge endpoints at the command boundary", () => {
  const base = {
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.add_edge",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "visual" as const, visualId: "vis-3" },
    source: "user" as const,
  };

  const malformedCases = [
    {
      edge: { to: "n2" },
      expected: "payload.edge.from must be a non-empty string.",
    },
    {
      edge: { from: "n1" },
      expected: "payload.edge.to must be a non-empty string.",
    },
    {
      edge: { from: 42, to: "n2" },
      expected: "payload.edge.from must be a non-empty string.",
    },
    {
      edge: { from: "", to: "n2" },
      expected: "payload.edge.from must be a non-empty string.",
    },
    {
      edge: { from: "n1", to: " " },
      expected: "payload.edge.to must be a non-empty string.",
    },
  ];

  for (const [index, { edge, expected }] of malformedCases.entries()) {
    const validation = validateCommandEnvelope(
      invalidEnvelope({
        ...base,
        id: commandId(`2101${index}`),
        payload: { op: "visual.add_edge", edge },
      }),
    );

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.includes(expected), expected);
  }

  const valid = validateCommandEnvelope(
    invalidEnvelope({
      ...base,
      id: commandId("21018"),
      payload: {
        op: "visual.add_edge",
        edge: {
          id: "e1",
          from: "n1",
          to: "n2",
          label: "",
          directed: false,
          style: "curved",
          arrowStyle: "open",
          lineStyle: "dashed",
          lineWidth: 2,
        },
      },
    }),
  );

  assert.equal(valid.valid, true);
});

test("validateCommandEnvelope validates add_edge optional edge fields", () => {
  const validation = validateCommandEnvelope(
    invalidEnvelope({
      id: commandId("21019"),
      schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
      type: "visual.add_edge",
      timestamp: BASE_TIMESTAMP,
      actor: ACTOR,
      target: { surface: "visual", visualId: "vis-3" },
      payload: {
        op: "visual.add_edge",
        edge: {
          id: "",
          from: "n1",
          to: "n2",
          label: 7,
          directed: "yes",
          style: "angled",
          arrowStyle: "triangle",
          lineStyle: "wavy",
          lineWidth: 0,
          extra: true,
        },
      },
      source: "user",
    }),
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("payload.edge.extra is not supported."));
  assert.ok(
    validation.errors.includes("payload.edge.id must be a non-empty string."),
  );
  assert.ok(validation.errors.includes("payload.edge.label must be a string."));
  assert.ok(
    validation.errors.includes("payload.edge.directed must be a boolean."),
  );
  assert.ok(
    validation.errors.includes(
      "payload.edge.style must be one of: straight, curved.",
    ),
  );
  assert.ok(
    validation.errors.includes(
      "payload.edge.arrowStyle must be one of: filled, open, circle, diamond.",
    ),
  );
  assert.ok(
    validation.errors.includes(
      "payload.edge.lineStyle must be one of: solid, dashed, dotted.",
    ),
  );
  assert.ok(
    validation.errors.includes(
      "payload.edge.lineWidth must be a positive number.",
    ),
  );
});

test("command envelopes remain JSON-serializable", () => {
  const envelope: CommandEnvelope = {
    id: commandId("2"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.set_effect",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "visual", visualId: "vis-2" },
    payload: {
      op: "visual.set_effect",
      effect: { kind: "shadow", dx: 4, dy: 6, blur: 8 },
    },
    source: "ai",
  };

  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), envelope);
});

test("deck envelopes validate when the envelope type matches the slide command type", () => {
  const payload: SlideCommand = {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "s1",
    title: "Reframed title",
    coalesceKey: "title:s1",
  };
  const envelope: CommandEnvelope<SlideCommand> = {
    id: commandId("3"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "UPDATE_SLIDE_TITLE",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "deck", documentId: "doc-9", slideId: "s1" },
    payload,
    coalesceKey: payload.coalesceKey,
    source: "user",
  };

  assert.equal(validateCommandEnvelope(envelope).valid, true);

  const deck = makeDeck(["s1"]);
  const result = executeCommand(deck, payload);
  const adapted = adaptSlideCommandResult(result, {
    documentId: envelope.target.documentId,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(adapted.affectedIds.documentIds, ["doc-9"]);
  assert.deepEqual(adapted.affectedIds.slideIds, ["s1"]);
  assert.equal(adapted.coalesceKey, "title:s1");
  assert.deepEqual(adapted.patches, result.patches);
});

test("deck envelopes reject mismatched envelope and payload command types", () => {
  const envelope = invalidEnvelope({
    id: commandId("9"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "REMOVE_SLIDE",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "deck", documentId: "doc-1" },
    payload: { type: "ADD_SLIDE", afterSlideId: null },
    source: "user",
  });

  const validation = validateCommandEnvelope(envelope);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes("Deck envelope type must match payload.type."),
  );
});

// ---------------------------------------------------------------------------
// Server-side acceptance boundary (#508)
// ---------------------------------------------------------------------------

function deckEnvelope(
  payload: SlideCommand,
  overrides: Partial<CommandEnvelope<SlideCommand>> = {},
): CommandEnvelope<SlideCommand> {
  return {
    id: commandId("a"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: payload.type,
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "deck", documentId: "doc-1" },
    payload,
    source: "user",
    ...overrides,
  };
}

const SOURCE_REF = {
  documentId: "doc-1",
  blockId: "blk-1",
  contentHash: "hash-1",
  linkedAt: BASE_TIMESTAMP,
  blockKind: "text" as const,
};

test("acceptDeckCommandEnvelope accepts a well-formed deck command for the target document", () => {
  const envelope = deckEnvelope({
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "el-1",
    unlink: true,
  });
  const acceptance = acceptDeckCommandEnvelope(envelope, {
    documentId: "doc-1",
  });
  assert.equal(acceptance.ok, true);
  assert.equal(acceptance.code, undefined);
  assert.deepEqual(acceptance.errors, []);
});

test("acceptDeckCommandEnvelope accepts source-ref commands carrying a valid sourceRef", () => {
  const refresh = deckEnvelope({
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "el-1",
    source: SOURCE_REF,
    text: "fresh",
  });
  const relink = deckEnvelope({
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "s1",
    elementId: "el-1",
    source: { ...SOURCE_REF, blockId: "blk-2" },
  });
  assert.equal(
    acceptDeckCommandEnvelope(refresh, { documentId: "doc-1" }).ok,
    true,
  );
  assert.equal(
    acceptDeckCommandEnvelope(relink, { documentId: "doc-1" }).ok,
    true,
  );
});

test("acceptDeckCommandEnvelope rejects a source command with malformed source", () => {
  const envelope = deckEnvelope(
    invalidSlideCommand({
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "s1",
      elementId: "el-1",
      // Missing required blockId / linkedAt and invalid blockKind.
      source: { documentId: "doc-1", blockKind: "bogus" },
    }),
  );
  const acceptance = acceptDeckCommandEnvelope(envelope, {
    documentId: "doc-1",
  });
  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.code, "malformed");
  assert.ok(
    acceptance.errors.some((e) => e.includes("payload.source.blockId")),
  );
  assert.ok(
    acceptance.errors.some((e) => e.includes("payload.source.blockKind")),
  );
});

test("acceptDeckCommandEnvelope rejects a malformed envelope", () => {
  const bad = invalidEnvelope({
    id: "not-a-uuid",
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "UPDATE_ELEMENT_SOURCE",
    timestamp: BASE_TIMESTAMP,
    actor: ACTOR,
    target: { surface: "deck", documentId: "doc-1" },
    payload: { type: "UPDATE_ELEMENT_SOURCE", slideId: "s1", unlink: true },
  });
  const acceptance = acceptDeckCommandEnvelope(bad, { documentId: "doc-1" });
  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.code, "malformed");
  assert.ok(acceptance.errors.some((e) => e.includes("UUID v4")));
  assert.ok(acceptance.errors.some((e) => e.includes("elementId")));
});

test("acceptDeckCommandEnvelope rejects an unsupported (future) schema version", () => {
  const envelope = deckEnvelope(
    {
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "s1",
      elementId: "el-1",
      unlink: true,
    },
    { schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION + 1 },
  );
  const acceptance = acceptDeckCommandEnvelope(envelope, {
    documentId: "doc-1",
  });
  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.code, "unsupported_schema_version");
});

test("acceptDeckCommandEnvelope rejects an envelope addressed to the wrong surface", () => {
  const envelope = deckEnvelope(
    {
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "s1",
      elementId: "el-1",
      unlink: true,
    },
    { target: { surface: "document", documentId: "doc-1" } },
  );
  const acceptance = acceptDeckCommandEnvelope(envelope, {
    documentId: "doc-1",
  });
  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.code, "wrong_target");
});

test("acceptDeckCommandEnvelope rejects an envelope addressed to a different document", () => {
  const envelope = deckEnvelope(
    {
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "s1",
      elementId: "el-1",
      unlink: true,
    },
    { target: { surface: "deck", documentId: "doc-OTHER" } },
  );
  const acceptance = acceptDeckCommandEnvelope(envelope, {
    documentId: "doc-1",
  });
  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.code, "wrong_document");
  assert.ok(acceptance.errors.some((e) => e.includes("doc-OTHER")));
});
