import assert from "node:assert/strict";
import { test } from "node:test";

import { CURRENT_COMMAND_SCHEMA_VERSION } from "@/lib/commands/command-envelope";
import {
  logCommandValidationFailure,
  validateDeckCommand,
  validateVisualCommand,
  type DeckCommandContext,
  type VisualCommandContext,
} from "@/lib/commands/command-validation";
import type { CommandEnvelope } from "@/lib/commands/command-envelope";
import type { VisualCommand } from "@/lib/commands/visual-command-contracts";
import type { SlideCommand } from "../document/deck-kernel/slide-commands";

const ACTOR = { id: "user-1", sessionId: "session-1" };

function commandId(suffix: string): string {
  return `20000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

function invalidSlideCommand(value: unknown): SlideCommand {
  return value as unknown as SlideCommand;
}

function makeVisualCommand(
  overrides: Partial<VisualCommand> = {},
): VisualCommand {
  return {
    id: commandId("1"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "visual.set_node_label",
    timestamp: "2026-06-23T00:00:00.000Z",
    actor: ACTOR,
    target: {
      surface: "visual",
      documentId: "doc-1",
      visualId: "vis-1",
      expectedRevision: "rev-1",
    },
    payload: {
      op: "visual.set_node_label",
      nodeId: "n1",
      label: "Updated",
    },
    source: "user",
    ...overrides,
  };
}

function makeDeckCommand(
  overrides: Partial<CommandEnvelope<SlideCommand>> = {},
): CommandEnvelope<SlideCommand> {
  return {
    id: commandId("2"),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "deck.slide_command",
    timestamp: "2026-06-23T00:00:00.000Z",
    actor: ACTOR,
    target: {
      surface: "deck",
      documentId: "doc-1",
      slideId: "s1",
      expectedRevision: "rev-1",
    },
    payload: {
      type: "UPDATE_SLIDE_TITLE",
      slideId: "s1",
      title: "Updated",
      coalesceKey: "title:s1",
    },
    source: "user",
    ...overrides,
  };
}

test("validateVisualCommand rejects actor/document mismatches as unauthorized", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-2",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(makeVisualCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unauthorized");
});

test("validateVisualCommand rejects malformed envelopes", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(
    makeVisualCommand({ id: "not-a-uuid" }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateVisualCommand rejects non-visual surfaces", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(
    makeVisualCommand({
      target: {
        surface: "deck" as never,
        documentId: "doc-1",
        visualId: "vis-1",
      },
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateVisualCommand rejects target document mismatches", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(
    makeVisualCommand({
      target: {
        surface: "visual",
        documentId: "doc-2",
        visualId: "vis-1",
      },
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unauthorized");
});

test("validateVisualCommand rejects missing visuals", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: false,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(makeVisualCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "missing_target");
});

test("validateVisualCommand rejects target visual mismatches", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(
    makeVisualCommand({
      target: {
        surface: "visual",
        documentId: "doc-1",
        visualId: "vis-2",
      },
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unauthorized");
});

test("validateVisualCommand accepts valid visual commands", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  assert.deepEqual(validateVisualCommand(makeVisualCommand(), ctx), {
    valid: true,
  });
});

test("validateDeckCommand rejects missing decks", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: false,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(makeDeckCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "missing_target");
});

test("validateDeckCommand rejects future schema versions as unsupported", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(
    makeDeckCommand({ schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION + 1 }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unsupported_command");
});

test("validateDeckCommand rejects malformed envelopes", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(makeDeckCommand({ id: "bad-id" }), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateDeckCommand rejects non-deck surfaces", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(
    makeDeckCommand({
      target: {
        surface: "visual" as never,
        documentId: "doc-1",
        slideId: "s1",
      },
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateDeckCommand rejects actor/document mismatches as unauthorized", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-2",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(makeDeckCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unauthorized");
});

test("validateDeckCommand rejects target document mismatches", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(
    makeDeckCommand({
      target: {
        surface: "deck",
        documentId: "doc-2",
        slideId: "s1",
      },
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unauthorized");
});

test("validateDeckCommand rejects unsupported slide payload types", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(
    makeDeckCommand({
      payload: invalidSlideCommand({ type: "BOGUS" }),
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateDeckCommand rejects stale revisions", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-2",
  };

  const result = validateDeckCommand(makeDeckCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "stale_revision");
});

test("validateDeckCommand rejects mismatched target and payload ids", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(
    makeDeckCommand({
      target: { surface: "deck", documentId: "doc-1", slideId: "s1" },
      payload: {
        type: "UPDATE_SLIDE_TITLE",
        slideId: "s2",
        title: "Mismatch",
      } as SlideCommand,
    }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateVisualCommand rejects invalid visual payloads", () => {
  const cmd = makeVisualCommand({
    payload: {
      op: "visual.set_node_style",
      nodeId: "n1",
      field: "fill" as never,
      value: "#abcdef",
    },
    type: "visual.set_node_style",
  });
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(cmd, ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "invalid_command");
});

test("validateVisualCommand rejects stale revisions", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-2",
  };

  const result = validateVisualCommand(makeVisualCommand(), ctx);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "stale_revision");
});

test("validateVisualCommand rejects future schema versions as unsupported", () => {
  const ctx: VisualCommandContext = {
    documentId: "doc-1",
    visualId: "vis-1",
    visualExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateVisualCommand(
    makeVisualCommand({ schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION + 1 }),
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, "unsupported_command");
});

test("validateDeckCommand accepts valid deck envelopes", () => {
  const ctx: DeckCommandContext = {
    documentId: "doc-1",
    deckExists: true,
    actorDocumentId: "doc-1",
    currentRevision: "rev-1",
  };

  const result = validateDeckCommand(makeDeckCommand(), ctx);
  assert.deepEqual(result, { valid: true });
});

test("logCommandValidationFailure emits allowlisted metadata without command payload content", () => {
  const cmd = makeDeckCommand({
    payload: {
      type: "UPDATE_SLIDE_TITLE",
      slideId: "s1",
      title: "SECRET TITLE",
    } as SlideCommand,
  });
  const result = {
    valid: false,
    errorCode: "invalid_command" as const,
    errorMessage: "Invalid command.",
  };
  const original = console.error;
  const lines: string[] = [];
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logCommandValidationFailure("command.validation.reject", result, cmd, {
      payload: { title: "SECRET TITLE" },
      text: "raw command text",
    });
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.scope, "command.validation.reject");
  assert.equal(record.commandId, cmd.id);
  assert.equal(record.errorCode, "invalid_command");
  assert.ok(!lines[0].includes("SECRET TITLE"));
  assert.ok(!lines[0].includes("raw command text"));
});

test("logCommandValidationFailure skips valid results", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logCommandValidationFailure(
      "command.validation.accept",
      { valid: true },
      makeDeckCommand(),
    );
  } finally {
    console.error = original;
  }

  assert.deepEqual(lines, []);
});

test("logCommandValidationFailure preserves UNSUPPORTED_COMMAND diagnostic code", () => {
  const cmd = makeVisualCommand({
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION + 1,
  });
  const result = {
    valid: false,
    errorCode: "unsupported_command" as const,
    errorMessage: "Unsupported command schema version.",
  };
  const original = console.error;
  const lines: string[] = [];
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logCommandValidationFailure("command.validation.reject", result, cmd);
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.scope, "command.validation.unsupported");
  assert.equal(record.code, "UNSUPPORTED_COMMAND");
  assert.equal(record.errorCode, "unsupported_command");
});
