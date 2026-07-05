import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildShapeNode,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";

import { availablePanels } from "./inspector-panel-ui";
import {
  filterSlideCommandPaletteCommands,
  resolveSlideCommandPaletteCommands,
  type SlideCommandPaletteContext,
} from "./slide-command-palette";

function context(
  overrides: Partial<SlideCommandPaletteContext> = {},
): SlideCommandPaletteContext {
  const selectedNode = overrides.selectedNode ?? null;
  const selectedCount =
    overrides.selectedCount ?? (selectedNode === null ? 0 : 1);
  return {
    hasActiveSlide: true,
    slideCount: 2,
    selectedNode,
    selectedCount,
    availablePanels: availablePanels(selectedNode, {
      multiSelect: selectedCount > 1,
      isDecoration: overrides.isDecorationSelected,
      hasDiagnostics: overrides.hasDiagnostics,
    }),
    capabilities: {
      canSave: true,
      canUndo: true,
      canRedo: false,
      canExportPdf: true,
    },
    ...overrides,
  };
}

function command(ctx: SlideCommandPaletteContext, id: string) {
  const found = resolveSlideCommandPaletteCommands(ctx).find(
    (entry) => entry.id === id,
  );
  assert.ok(found, `${id} should resolve`);
  return found;
}

describe("resolveSlideCommandPaletteCommands", () => {
  test("keeps slide and insert commands discoverable with no selection", () => {
    const commands = resolveSlideCommandPaletteCommands(
      context({ selectedNode: null, selectedCount: 0, slideCount: 1 }),
    );

    assert.equal(
      command(context(), "slide.insert-text").disabledReason,
      undefined,
    );
    assert.equal(
      command(
        context({ selectedNode: null, selectedCount: 0 }),
        "selection.delete",
      ).disabledReasonCode,
      "missing-selection",
    );
    assert.equal(
      commands.some((entry) => entry.id === "inspector.slide"),
      true,
    );
    assert.equal(
      command(context({ slideCount: 1 }), "slide.delete").disabledReasonCode,
      "minimum-slide-count",
    );
  });

  test("resolves single-node commands and source-review disabled state", () => {
    const shape = buildShapeNode();
    const ctx = context({ selectedNode: shape });

    assert.equal(command(ctx, "shape.update-fill").disabledReason, undefined);
    assert.equal(
      command(context({ selectedNode: buildTextNode() }), "connector.create")
        .disabledReasonCode,
      "missing-handler",
    );
    assert.equal(
      command(ctx, "selection.group").disabledReasonCode,
      "requires-multi-selection",
    );
    assert.equal(
      command(ctx, "source.review").disabledReasonCode,
      "read-only-source",
    );
    assert.equal(
      command(
        context({ selectedNode: shape, hasSelectedSource: true }),
        "source.review",
      ).disabledReason,
      undefined,
    );
  });

  test("resolves multi-selection arrange commands with count-sensitive reasons", () => {
    const twoSelected = context({
      selectedNode: buildTextNode(),
      selectedCount: 2,
    });
    const threeSelected = context({
      selectedNode: buildTextNode(),
      selectedCount: 3,
    });

    assert.equal(
      command(twoSelected, "selection.align-left").disabledReason,
      undefined,
    );
    assert.equal(
      command(twoSelected, "selection.group").disabledReason,
      undefined,
    );
    assert.equal(
      command(twoSelected, "selection.distribute-horizontal")
        .disabledReasonCode,
      "requires-three-selections",
    );
    assert.equal(
      command(threeSelected, "selection.distribute-horizontal").disabledReason,
      undefined,
    );
    assert.equal(
      command(threeSelected, "selection.match-height").disabledReason,
      undefined,
    );
  });

  test("keeps text and table editing states context-sensitive", () => {
    const textEditing = context({
      selectedNode: buildTextNode(),
      isInlineEditing: true,
    });
    const tableEditing = context({
      selectedNode: buildTableNode(),
      isTableEditing: true,
    });

    assert.equal(
      command(textEditing, "selection.reorder-forward").disabledReasonCode,
      "requires-finished-editing",
    );
    assert.equal(command(textEditing, "text.bold").disabledReason, undefined);
    assert.equal(
      command(tableEditing, "table.insert-row").disabledReason,
      undefined,
    );
  });

  test("surfaces diagnostics, exports, and query filtering", () => {
    const ctx = context({ hasDiagnostics: true });
    const commands = resolveSlideCommandPaletteCommands(ctx);

    assert.equal(command(ctx, "diagnostics.open").disabledReason, undefined);
    assert.equal(command(ctx, "export.pdf").disabledReason, undefined);
    assert.equal(
      command(ctx, "export.pptx").disabledReasonCode,
      "missing-capability",
    );
    assert.deepEqual(
      filterSlideCommandPaletteCommands(commands, "open diagnostics").map(
        (entry) => entry.id,
      ),
      ["diagnostics.open", "diagnostics.repair", "inspector.diagnostics"],
    );
  });

  test("matches toolbar save guards for route commands", () => {
    const saving = context({
      capabilities: {
        canPresent: true,
        canShare: true,
        saveStatus: "saving",
      },
    });

    assert.equal(
      command(saving, "deck.present").disabledReasonCode,
      "already-saving",
    );
    assert.equal(
      command(saving, "deck.share").disabledReasonCode,
      "already-saving",
    );
  });
});
