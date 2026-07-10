/**
 * Cross-surface command tests.
 *
 * NOTE: there is no runtime "command bus" object. These tests exercise the real
 * architecture — pure executors (`executeCommand`, `executeVisualCommand`)
 * behind serializable `CommandEnvelope` records and the adapters
 * (`adaptSlideCommandResult`, `adaptVisualCommandResult`) that normalize results
 * into the shared `CrossSurfaceCommandResult` shape. The `applyMixedBatch`
 * helper below simulates how a caller would replay a heterogeneous stream of
 * visual + deck commands; it is not a dispatcher under test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURRENT_COMMAND_SCHEMA_VERSION,
  adaptSlideCommandResult,
  type CommandEnvelope,
  type CrossSurfaceCommandResult,
} from "@/lib/commands/command-envelope";
import {
  adaptVisualCommandResult,
  coalesceVisualCommands,
  executeVisualCommand,
} from "@/lib/commands/visual-commands";
import type {
  VisualCommand,
  VisualPatch,
  VisualSideEffect,
} from "@/lib/commands/visual-command-contracts";
import {
  coalesceCommands,
  executeCommand,
  type DeckPatch,
  type SlideCommand,
} from "../document/deck-kernel/slide-commands";
import { createBlankVisual } from "@/lib/visual/blank";
import type { Deck } from "../document/deck-kernel/deck";
import type { Visual } from "@/lib/visual/schema";
import { makeDeckFromIds } from "@/test/builders/deck";
import { makeVisualCommand } from "@/test/builders/commands";

const ACTOR = { id: "user-1", sessionId: "session-1" };
const DOC_ID = "doc-1";
const VISUAL_ID = "vis-1";

type DeckEnvelope = CommandEnvelope<SlideCommand> & {
  target: { surface: "deck"; documentId: string; slideId?: string };
};

type BatchEntry =
  | { kind: "visual"; command: VisualCommand }
  | { kind: "deck"; command: DeckEnvelope };

type CrossSurfaceResult = CrossSurfaceCommandResult<
  DeckPatch | VisualPatch,
  VisualSideEffect
>;

function commandId(prefix: string, suffix: string): string {
  return `${prefix}0000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

const makeDeck = makeDeckFromIds;

function makeDeckEnvelope(
  payload: SlideCommand,
  overrides: Partial<DeckEnvelope> = {},
): DeckEnvelope {
  return {
    id: commandId("4", String(payload.type.length)),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: "deck.slide_command",
    timestamp: "2026-06-23T00:00:00.000Z",
    actor: ACTOR,
    target: {
      surface: "deck",
      documentId: DOC_ID,
      ...("slideId" in payload && payload.slideId
        ? { slideId: payload.slideId }
        : {}),
    },
    payload,
    ...("coalesceKey" in payload && payload.coalesceKey
      ? { coalesceKey: payload.coalesceKey }
      : {}),
    source: "user",
    ...overrides,
  };
}

function applyMixedBatch(
  deck: Deck,
  visual: Visual,
  batch: BatchEntry[],
): { deck: Deck; visual: Visual; results: CrossSurfaceResult[] } {
  const results: CrossSurfaceResult[] = [];
  let currentDeck = deck;
  let currentVisual = visual;

  for (const entry of batch) {
    if (entry.kind === "visual") {
      const result = executeVisualCommand(currentVisual, entry.command);
      results.push(adaptVisualCommandResult(entry.command, result));
      if (!result.ok) {
        break;
      }
      currentVisual = result.visual;
      continue;
    }

    const result = executeCommand(currentDeck, entry.command.payload);
    results.push(
      adaptSlideCommandResult(result, {
        documentId: entry.command.target.documentId,
      }),
    );
    if (!result.ok) {
      break;
    }
    currentDeck = result.deck;
  }

  return { deck: currentDeck, visual: currentVisual, results };
}

function coalesceDeckEnvelopes(history: DeckEnvelope[]): DeckEnvelope[] {
  if (history.length === 0) {
    return history;
  }

  const result: DeckEnvelope[] = [history[0]!];
  for (let index = 1; index < history.length; index += 1) {
    const previous = result[result.length - 1]!;
    const current = history[index]!;
    const merged = coalesceCommands([previous.payload, current.payload]);
    if (
      previous.coalesceKey !== undefined &&
      previous.coalesceKey === current.coalesceKey &&
      previous.target.documentId === current.target.documentId &&
      merged.length === 1
    ) {
      result[result.length - 1] = {
        ...previous,
        timestamp: current.timestamp,
        source: current.source,
        payload: merged[0]!,
      };
    } else {
      result.push(current);
    }
  }

  return result;
}

function coalesceMixedBatch(batch: BatchEntry[]): BatchEntry[] {
  const result: BatchEntry[] = [];
  let index = 0;

  while (index < batch.length) {
    const current = batch[index]!;
    const group: BatchEntry[] = [current];
    index += 1;
    while (index < batch.length && batch[index]!.kind === current.kind) {
      group.push(batch[index]!);
      index += 1;
    }

    if (current.kind === "visual") {
      result.push(
        ...coalesceVisualCommands(
          group.map(
            (entry) =>
              (entry as Extract<BatchEntry, { kind: "visual" }>).command,
          ),
        ).map((command) => ({ kind: "visual", command }) as const),
      );
    } else {
      result.push(
        ...coalesceDeckEnvelopes(
          group.map(
            (entry) => (entry as Extract<BatchEntry, { kind: "deck" }>).command,
          ),
        ).map((command) => ({ kind: "deck", command }) as const),
      );
    }
  }

  return result;
}

test("mixed command batches replay deterministically across visual and deck surfaces", () => {
  const deck = makeDeck(["s1"]);
  const visual = createBlankVisual("flowchart");
  const batch: BatchEntry[] = [
    {
      kind: "visual",
      command: makeVisualCommand({
        op: "visual.set_style",
        patch: { background: "#111111", fontWeight: 700 },
      }),
    },
    {
      kind: "deck",
      command: makeDeckEnvelope({
        type: "UPDATE_SLIDE_TITLE",
        slideId: "s1",
        title: "Cross-surface title",
        coalesceKey: "title:s1",
      }),
    },
    {
      kind: "visual",
      command: makeVisualCommand({
        op: "visual.set_node_label",
        nodeId: "n2",
        label: "Review",
      }),
    },
  ];

  const first = applyMixedBatch(deck, visual, batch);
  const second = applyMixedBatch(deck, visual, batch);

  assert.deepEqual(first.deck, second.deck);
  assert.deepEqual(first.visual, second.visual);
  assert.deepEqual(first.results, second.results);
});

test("mixed command history coalesces contiguous runs per surface", () => {
  const batch: BatchEntry[] = [
    {
      kind: "visual",
      command: makeVisualCommand(
        {
          op: "visual.set_style",
          patch: { background: "#111111" },
        },
        { coalesceKey: "visual-style" },
      ),
    },
    {
      kind: "visual",
      command: makeVisualCommand(
        {
          op: "visual.set_style",
          patch: { nodeFill: "#222222" },
        },
        { coalesceKey: "visual-style" },
      ),
    },
    {
      kind: "deck",
      command: makeDeckEnvelope({
        type: "UPDATE_SLIDE_TITLE",
        slideId: "s1",
        title: "A",
        coalesceKey: "title:s1",
      }),
    },
    {
      kind: "deck",
      command: makeDeckEnvelope({
        type: "UPDATE_SLIDE_TITLE",
        slideId: "s1",
        title: "B",
        coalesceKey: "title:s1",
      }),
    },
    {
      kind: "visual",
      command: makeVisualCommand({
        op: "visual.set_node_label",
        nodeId: "n1",
        label: "Final",
      }),
    },
  ];

  const coalesced = coalesceMixedBatch(batch);

  assert.equal(coalesced.length, 3);
  assert.deepEqual(
    (coalesced[0] as Extract<BatchEntry, { kind: "visual" }>).command.payload,
    {
      op: "visual.set_style",
      patch: { background: "#111111", nodeFill: "#222222" },
    },
  );
  assert.equal(
    (
      (coalesced[1] as Extract<BatchEntry, { kind: "deck" }>).command
        .payload as Extract<SlideCommand, { type: "UPDATE_SLIDE_TITLE" }>
    ).title,
    "B",
  );
});

test("visual coalescing does not merge commands from different actors or sources", () => {
  const history = coalesceVisualCommands([
    makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n1", label: "Alice" },
      {
        actor: { id: "alice", sessionId: "session-a" },
        source: "user",
        coalesceKey: "label:n1",
      },
    ),
    makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n1", label: "Bob" },
      {
        actor: { id: "bob", sessionId: "session-b" },
        source: "sync",
        coalesceKey: "label:n1",
      },
    ),
  ]);

  assert.equal(history.length, 2);
});

test("mixed command batches stop on failure without mutating the failed surface", () => {
  const deck = makeDeck(["s1"]);
  const visual = createBlankVisual("flowchart");
  const batch: BatchEntry[] = [
    {
      kind: "deck",
      command: makeDeckEnvelope({
        type: "UPDATE_SLIDE_TITLE",
        slideId: "s1",
        title: "Committed",
      }),
    },
    {
      kind: "visual",
      command: makeVisualCommand({
        op: "visual.set_node_label",
        nodeId: "missing-node",
        label: "Should fail",
      }),
    },
    {
      kind: "deck",
      command: makeDeckEnvelope({
        type: "UPDATE_SLIDE_NOTES",
        slideId: "s1",
        notes: "Should not run",
      }),
    },
  ];

  const applied = applyMixedBatch(deck, visual, batch);

  assert.equal(applied.results.length, 2);
  assert.equal(applied.results[1]!.ok, false);
  assert.equal(applied.visual, visual);
  assert.equal(applied.deck.slides[0]!.title, "Committed");
  assert.equal(applied.deck.slides[0]!.notes, "");
  assert.deepEqual(applied.results[1]!.patches, []);
});

test("mixed command batches expose unified affected ids, patches, and side effects", () => {
  const applied = applyMixedBatch(
    makeDeck(["s1"]),
    createBlankVisual("flowchart"),
    [
      {
        kind: "visual",
        command: makeVisualCommand(
          {
            op: "visual.set_effect",
            effect: { kind: "shadow", dx: 4, dy: 4, blur: 6 },
          },
          { coalesceKey: "effect:shadow" },
        ),
      },
      {
        kind: "deck",
        command: makeDeckEnvelope({
          type: "UPDATE_SLIDE_TITLE",
          slideId: "s1",
          title: "Deck title",
          coalesceKey: "title:s1",
        }),
      },
    ],
  );

  assert.deepEqual(applied.results[0]!.affectedIds.visualIds, [VISUAL_ID]);
  assert.ok(
    applied.results[0]!.sideEffects.some(
      (effect) => effect.kind === "render_invalidation",
    ),
  );
  assert.equal(applied.results[0]!.coalesceKey, "effect:shadow");
  assert.deepEqual(applied.results[1]!.affectedIds.documentIds, [DOC_ID]);
  assert.deepEqual(applied.results[1]!.affectedIds.slideIds, ["s1"]);
  assert.equal(applied.results[1]!.coalesceKey, "title:s1");
});

test("masterId, templateId, and designOverrides survive adaptSlideCommandResult", () => {
  const deck = makeDeck(["s1"]);

  // masterId — SET_SLIDE_MASTER produces slideFields[slideId].masterId
  const masterResult = executeCommand(deck, {
    type: "SET_SLIDE_MASTER",
    slideId: "s1",
    masterId: "master-default",
  });
  assert.ok(masterResult.ok, "SET_SLIDE_MASTER should succeed");
  const adaptedMaster = adaptSlideCommandResult(masterResult, {
    documentId: DOC_ID,
  });
  assert.equal(
    adaptedMaster.patches[0]?.slideFields?.["s1"]?.masterId,
    "master-default",
  );

  // templateId — APPLY_SLIDE_TEMPLATE produces slideFields[slideId].templateId
  const templateResult = executeCommand(deck, {
    type: "APPLY_SLIDE_TEMPLATE",
    slideId: "s1",
    templateId: "blank",
  });
  assert.ok(templateResult.ok, "APPLY_SLIDE_TEMPLATE should succeed");
  const adaptedTemplate = adaptSlideCommandResult(templateResult, {
    documentId: DOC_ID,
  });
  assert.equal(
    adaptedTemplate.patches[0]?.slideFields?.["s1"]?.templateId,
    "blank",
  );

  // designOverrides — SET_SLIDE_BACKGROUND produces slideFields[slideId].designOverrides
  const bgResult = executeCommand(deck, {
    type: "SET_SLIDE_BACKGROUND",
    slideId: "s1",
    background: "#ff0000",
  });
  assert.ok(bgResult.ok, "SET_SLIDE_BACKGROUND should succeed");
  const adaptedBg = adaptSlideCommandResult(bgResult, { documentId: DOC_ID });
  assert.deepEqual(adaptedBg.patches[0]?.slideFields?.["s1"]?.designOverrides, {
    background: { type: "solid", color: { value: "#ff0000" } },
  });
});
