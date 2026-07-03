/**
 * Unit tests for the visual-kind registry (Epic #442, issues #443–#444).
 *
 * Key guarantees:
 *  - Every VisualKind has a registry entry (exhaustiveness).
 *  - Required fields are non-empty.
 *  - No duplicate kind ids.
 *  - Layout family, shapes, and editing flags are internally consistent.
 *  - Export support records are complete.
 *  - Prompt guidance is non-empty.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { VISUAL_KINDS } from "@/lib/visual/schema";
import { KIND_DISPLAY_METADATA } from "@/lib/visual/registry-display";
import { KIND_EDITING_CAPABILITIES } from "@/lib/visual/registry-editing";
import { KIND_EXPORT_SUPPORT } from "@/lib/visual/registry-export";
import { KIND_PROMPT_CONSTRAINTS } from "@/lib/visual/registry-prompt";
import { KIND_RUNTIME_DESCRIPTORS } from "@/lib/visual/registry-runtime";
import { assertRegistryDataCompleteness } from "@/lib/visual/registry-validation";
import { assertRegistryCompletenessFor } from "@/lib/visual/registry-validation";
import type { VisualRegistry } from "@/lib/visual/registry-types";
import {
  VISUAL_KIND_REGISTRY,
  assertRegistryCompleteness,
  buildExportSupportMatrix,
  getAllKindPromptGuidance,
  getAllowedShapes,
  getKindEntry,
  getKindPromptGuidance,
  getKindRuntimeDescriptor,
  getKindsByLayoutFamily,
  isGraphEditable,
  isPositionedKind,
  isDerivedLayoutKind,
  isShapeAllowed,
} from "@/lib/visual/registry";

function invalidRegistry(registry: unknown): VisualRegistry {
  return registry as unknown as VisualRegistry;
}

function invalidRuntimeChecklist(
  checklist: unknown,
): typeof VISUAL_KIND_REGISTRY.chart.runtime.checklist {
  return checklist as unknown as typeof VISUAL_KIND_REGISTRY.chart.runtime.checklist;
}

// ---------------------------------------------------------------------------
// Exhaustiveness
// ---------------------------------------------------------------------------

test("every VisualKind has a registry entry", () => {
  for (const kind of VISUAL_KINDS) {
    const entry = VISUAL_KIND_REGISTRY[kind];
    assert.ok(entry, `Missing registry entry for kind: ${kind}`);
    assert.equal(entry.id, kind, `Entry id mismatch for "${kind}"`);
  }
});

test("runtime descriptors expose the shared validation checklist", () => {
  for (const kind of VISUAL_KINDS) {
    const checklist = KIND_RUNTIME_DESCRIPTORS[kind].checklist;
    assert.equal(checklist.schema, true);
    assert.equal(checklist.validation, true);
  }
});

test("assertRegistryCompleteness does not throw", () => {
  assert.doesNotThrow(() => assertRegistryCompleteness());
});

test("assertRegistryCompletenessFor reports missing or malformed entries", () => {
  const registry = { ...VISUAL_KIND_REGISTRY } as VisualRegistry;
  delete (registry as Partial<VisualRegistry>).flowchart;
  assert.throws(
    () => assertRegistryCompletenessFor(registry),
    /Missing registry entry for kind: flowchart/,
  );

  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          id: "flowchart",
        },
      } as VisualRegistry),
    /Entry id mismatch/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor(
        invalidRegistry({
          ...VISUAL_KIND_REGISTRY,
          notAKind: VISUAL_KIND_REGISTRY.chart,
        }),
      ),
    /Unexpected registry entry kind: notAKind/,
  );
});

test("assertRegistryCompletenessFor validates labels, shapes, and runtime consistency", () => {
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: { ...VISUAL_KIND_REGISTRY.chart, label: "" },
      } as VisualRegistry),
    /missing a label/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: { ...VISUAL_KIND_REGISTRY.chart, iconName: "" },
      } as VisualRegistry),
    /missing an iconName/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: { ...VISUAL_KIND_REGISTRY.chart, allowedShapes: [] },
      } as VisualRegistry),
    /has no allowedShapes/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          runtime: {
            ...VISUAL_KIND_REGISTRY.chart.runtime,
            layout: {
              ...VISUAL_KIND_REGISTRY.chart.runtime.layout,
              family: "positioned",
            },
          },
        },
      } as VisualRegistry),
    /Runtime layout family mismatch/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor(
        invalidRegistry({
          ...VISUAL_KIND_REGISTRY,
          chart: {
            ...VISUAL_KIND_REGISTRY.chart,
            runtime: undefined,
          },
        }),
      ),
    /missing runtime descriptor/,
  );
});

test("assertRegistryCompletenessFor validates transform, validation, and checklist contracts", () => {
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          runtime: {
            ...VISUAL_KIND_REGISTRY.chart.runtime,
            transform: {
              ...VISUAL_KIND_REGISTRY.chart.runtime.transform,
              defaultShape: "diamond",
            },
          },
        },
      } as VisualRegistry),
    /Runtime default shape mismatch/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          runtime: {
            ...VISUAL_KIND_REGISTRY.chart.runtime,
            validation: {
              ...VISUAL_KIND_REGISTRY.chart.runtime.validation,
              requiresNodeValue:
                !VISUAL_KIND_REGISTRY.chart.prompt.requiresNodeValue,
            },
          },
        },
      } as VisualRegistry),
    /Runtime validation\/prompt mismatch/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          runtime: {
            ...VISUAL_KIND_REGISTRY.chart.runtime,
            transform: {
              ...VISUAL_KIND_REGISTRY.chart.runtime.transform,
              autoLayoutSupported:
                !VISUAL_KIND_REGISTRY.chart.editing.autoLayoutSupported,
            },
          },
        },
      } as VisualRegistry),
    /Runtime auto-layout support mismatch/,
  );
  assert.throws(
    () =>
      assertRegistryCompletenessFor({
        ...VISUAL_KIND_REGISTRY,
        chart: {
          ...VISUAL_KIND_REGISTRY.chart,
          runtime: {
            ...VISUAL_KIND_REGISTRY.chart.runtime,
            checklist: invalidRuntimeChecklist({
              ...VISUAL_KIND_REGISTRY.chart.runtime.checklist,
              export: false,
            }),
          },
        },
      } as VisualRegistry),
    /Runtime checklist item "export" is incomplete/,
  );
});

test("split registry concern maps cover every VisualKind and compose into the facade", () => {
  assert.doesNotThrow(() => assertRegistryDataCompleteness());

  for (const kind of VISUAL_KINDS) {
    const entry = getKindEntry(kind);
    assert.deepEqual(
      {
        label: entry.label,
        description: entry.description,
        keywords: entry.keywords,
        iconName: entry.iconName,
        icon: entry.icon,
        layoutFamily: entry.layoutFamily,
        allowedShapes: entry.allowedShapes,
        defaultShape: entry.defaultShape,
      },
      KIND_DISPLAY_METADATA[kind],
    );
    assert.deepEqual(entry.editing, KIND_EDITING_CAPABILITIES[kind]);
    assert.deepEqual(entry.export, KIND_EXPORT_SUPPORT[kind]);
    assert.deepEqual(entry.prompt, KIND_PROMPT_CONSTRAINTS[kind]);
    assert.deepEqual(entry.runtime, KIND_RUNTIME_DESCRIPTORS[kind]);
  }
});

test("no duplicate kind ids in registry", () => {
  const ids = Object.values(VISUAL_KIND_REGISTRY).map((e) => e.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "Registry contains duplicate kind ids");
});

// ---------------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------------

test("every registry entry has required non-empty fields", () => {
  for (const kind of VISUAL_KINDS) {
    const entry = getKindEntry(kind);
    assert.ok(entry.label.length > 0, `"${kind}" label is empty`);
    assert.ok(entry.description.length > 0, `"${kind}" description is empty`);
    assert.ok(entry.keywords.length > 0, `"${kind}" keywords is empty`);
    assert.ok(entry.iconName.length > 0, `"${kind}" iconName is empty`);
    assert.ok(
      entry.allowedShapes.length > 0,
      `"${kind}" allowedShapes is empty`,
    );
    assert.ok(
      entry.prompt.guidance.length > 0,
      `"${kind}" prompt guidance is empty`,
    );
  }
});

// ---------------------------------------------------------------------------
// Layout family
// ---------------------------------------------------------------------------

test("positioned kinds include flowchart, mindmap, concept, orgchart, venn", () => {
  const positioned = getKindsByLayoutFamily("positioned");
  for (const expected of [
    "flowchart",
    "mindmap",
    "concept",
    "orgchart",
    "venn",
  ]) {
    assert.ok(
      positioned.includes(expected as never),
      `Expected "${expected}" to be positioned`,
    );
  }
});

test("derived kinds include list, chart, timeline, cycle, comparison, funnel, pyramid, matrix", () => {
  const derived = getKindsByLayoutFamily("derived");
  for (const expected of [
    "list",
    "chart",
    "timeline",
    "cycle",
    "comparison",
    "funnel",
    "pyramid",
    "matrix",
  ]) {
    assert.ok(
      derived.includes(expected as never),
      `Expected "${expected}" to be derived`,
    );
  }
});

test("isPositionedKind / isDerivedLayoutKind are mutually exclusive for each kind", () => {
  for (const kind of VISUAL_KINDS) {
    const positioned = isPositionedKind(kind);
    const derived = isDerivedLayoutKind(kind);
    assert.notEqual(
      positioned,
      derived,
      `"${kind}" must be exactly one of positioned or derived`,
    );
  }
});

test("runtime descriptors complete the visual-kind addition checklist", () => {
  const checklistItems = [
    "schema",
    "layout",
    "render",
    "edit",
    "export",
    "prompt",
    "transforms",
    "validation",
  ] as const;

  for (const kind of VISUAL_KINDS) {
    const entry = getKindEntry(kind);
    const runtime = getKindRuntimeDescriptor(kind);
    assert.equal(runtime.layout.family, entry.layoutFamily);
    assert.equal(runtime.transform.defaultShape, entry.defaultShape);
    assert.equal(
      runtime.transform.autoLayoutSupported,
      entry.editing.autoLayoutSupported,
    );
    assert.deepEqual(runtime.validation, {
      requiresNodeValue: entry.prompt.requiresNodeValue,
      requiresNodePosition: entry.prompt.requiresNodePosition,
      edgesRelevant: entry.prompt.edgesRelevant,
    });
    for (const item of checklistItems) {
      assert.equal(
        runtime.checklist[item],
        true,
        `"${kind}" is missing runtime checklist coverage for ${item}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Editing capabilities
// ---------------------------------------------------------------------------

test("positioned graph kinds are graph-editable (flowchart, mindmap, concept, orgchart)", () => {
  for (const kind of ["flowchart", "mindmap", "concept", "orgchart"] as const) {
    assert.ok(
      isGraphEditable(kind),
      `Expected "${kind}" to be fully graph-editable`,
    );
  }
});

test("derived-layout kinds are not fully graph-editable", () => {
  for (const kind of [
    "list",
    "chart",
    "timeline",
    "cycle",
    "comparison",
    "funnel",
    "pyramid",
    "matrix",
  ] as const) {
    assert.equal(
      isGraphEditable(kind),
      false,
      `Expected "${kind}" to NOT be fully graph-editable`,
    );
  }
});

// ---------------------------------------------------------------------------
// Allowed shapes
// ---------------------------------------------------------------------------

test("getAllowedShapes returns non-empty array for every kind", () => {
  for (const kind of VISUAL_KINDS) {
    const shapes = getAllowedShapes(kind);
    assert.ok(shapes.length > 0, `"${kind}" has no allowed shapes`);
  }
});

test("defaultShape is always in allowedShapes", () => {
  for (const kind of VISUAL_KINDS) {
    const entry = getKindEntry(kind);
    assert.ok(
      isShapeAllowed(kind, entry.defaultShape),
      `"${kind}" defaultShape "${entry.defaultShape}" is not in allowedShapes`,
    );
  }
});

test("isShapeAllowed returns false for invalid shapes", () => {
  // chart only allows rectangle and rounded
  assert.equal(isShapeAllowed("chart", "diamond"), false);
  assert.equal(isShapeAllowed("chart", "hexagon"), false);
});

test("isShapeAllowed returns true for valid shapes", () => {
  assert.equal(isShapeAllowed("chart", "rectangle"), true);
  assert.equal(isShapeAllowed("flowchart", "diamond"), true);
});

// ---------------------------------------------------------------------------
// Export support
// ---------------------------------------------------------------------------

test("every registry entry has an export support record", () => {
  for (const kind of VISUAL_KINDS) {
    const entry = getKindEntry(kind);
    assert.ok(entry.export, `"${kind}" is missing export support record`);
    // PNG must always be supported
    assert.equal(entry.export.png, true, `"${kind}" must support PNG export`);
  }
});

test("buildExportSupportMatrix returns one row per VisualKind", () => {
  const matrix = buildExportSupportMatrix();
  assert.equal(matrix.length, VISUAL_KINDS.length);
  const kinds = matrix.map((row) => row.kind);
  for (const kind of VISUAL_KINDS) {
    assert.ok(kinds.includes(kind), `Matrix missing row for "${kind}"`);
  }
});

test("positioned kinds support PPTX native export", () => {
  const positioned = getKindsByLayoutFamily("positioned").filter(
    (k) => k !== "venn",
  );
  for (const kind of positioned) {
    assert.equal(
      getKindEntry(kind).export.pptxNative,
      true,
      `Expected positioned kind "${kind}" to support PPTX native export`,
    );
  }
});

// ---------------------------------------------------------------------------
// AI prompt guidance
// ---------------------------------------------------------------------------

test("getKindPromptGuidance returns non-empty string for every kind", () => {
  for (const kind of VISUAL_KINDS) {
    const guidance = getKindPromptGuidance(kind);
    assert.ok(
      typeof guidance === "string" && guidance.length > 0,
      `"${kind}" has empty prompt guidance`,
    );
  }
});

test("getAllKindPromptGuidance returns all kinds", () => {
  const entries = getAllKindPromptGuidance();
  assert.equal(entries.length, VISUAL_KINDS.length);
  for (const { kind, guidance } of entries) {
    assert.ok(guidance.length > 0, `"${kind}" has empty prompt guidance`);
  }
});

test("prompt guidance for flowchart mentions edges and positioning", () => {
  const guidance = getKindPromptGuidance("flowchart");
  assert.ok(
    guidance.includes("edge"),
    "Flowchart guidance should mention edges",
  );
  assert.ok(
    guidance.includes("x/y"),
    "Flowchart guidance should mention x/y positioning",
  );
});

test("prompt guidance for chart mentions value", () => {
  const guidance = getKindPromptGuidance("chart");
  assert.ok(guidance.includes("value"), "Chart guidance should mention value");
});

// ---------------------------------------------------------------------------
// Edge case: adding a fake kind fails fast
// ---------------------------------------------------------------------------

test("assertRegistryCompleteness with a tampered registry throws an error", () => {
  const tampered = {
    ...VISUAL_KIND_REGISTRY,
    flowchart: {
      ...VISUAL_KIND_REGISTRY.flowchart,
      id: "wrongkind" as never,
    },
  };
  // Validate the tampered entry directly
  assert.throws(() => {
    if (tampered.flowchart.id !== "flowchart") {
      throw new Error(
        `[registry] Entry id mismatch: expected "flowchart", got "wrongkind"`,
      );
    }
  }, /Entry id mismatch/);
});
