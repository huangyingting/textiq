import assert from "node:assert/strict";
import test from "node:test";

import { parseMarkdown } from "@/lib/content";
import { VISUAL_KINDS } from "@/lib/visual/schema";
import {
  BLANK_TEMPLATE_ID,
  TEMPLATE_CATALOG,
  assertTemplateCatalogCompleteness,
  getTemplate,
  getTemplateOrBlank,
  type TemplateEntry,
} from "@/lib/templates/catalog";

function invalidTemplateContent(value: unknown): string {
  return value as unknown as string;
}

test("catalog has at least nine templates including the expected set", () => {
  assert.ok(TEMPLATE_CATALOG.length >= 9);
  const names = TEMPLATE_CATALOG.map((entry) => entry.name);
  assert.ok(names.includes("Blank"));
  assert.ok(names.includes("Process / Flowchart"));
  assert.ok(names.includes("Mind Map"));
  assert.ok(names.includes("Comparison"));
  assert.ok(names.includes("How It Works"));
  assert.ok(names.includes("Timeline / Roadmap"));
  assert.ok(names.includes("Org / Team"));
  assert.ok(names.includes("Pros & Cons"));
  assert.ok(names.includes("Cycle / Loop"));
});

test("entries are well-formed with unique ids", () => {
  const seen = new Set<string>();
  for (const entry of TEMPLATE_CATALOG) {
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0);
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 0);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 0);
    assert.equal(typeof entry.content, "string");
    assert.ok(!seen.has(entry.id), `duplicate template id: ${entry.id}`);
    seen.add(entry.id);
  }
});

test("split template data and fallback lookup stay complete", () => {
  assert.doesNotThrow(() => assertTemplateCatalogCompleteness());
  assert.equal(
    getTemplateOrBlank("__missing-template__").id,
    BLANK_TEMPLATE_ID,
  );
});

test("every template content parses to at least one block", () => {
  for (const entry of TEMPLATE_CATALOG) {
    const blocks = parseMarkdown(entry.content);
    assert.ok(
      blocks.length >= 1,
      `template ${entry.id} parsed to ${blocks.length} blocks`,
    );
  }
});

test("any visualKind is a valid VisualKind", () => {
  for (const entry of TEMPLATE_CATALOG) {
    if (entry.visualKind !== undefined) {
      assert.ok(
        (VISUAL_KINDS as readonly string[]).includes(entry.visualKind),
        `template ${entry.id} has invalid visualKind: ${entry.visualKind}`,
      );
    }
  }
});

test("a Blank template exists with the documented id and no visualKind", () => {
  const blank = getTemplate(BLANK_TEMPLATE_ID);
  assert.ok(blank);
  assert.equal(blank?.name, "Blank");
  assert.equal(blank?.visualKind, undefined);
});

test("getTemplate returns the matching entry or undefined", () => {
  const entry: TemplateEntry | undefined = getTemplate("flowchart");
  assert.equal(entry?.visualKind, "flowchart");
  assert.equal(getTemplate("not-a-real-template"), undefined);
});

test("getTemplateOrBlank falls back to Blank for unknown/missing ids", () => {
  assert.equal(getTemplateOrBlank("flowchart").id, "flowchart");
  assert.equal(getTemplateOrBlank("not-a-real-template").id, BLANK_TEMPLATE_ID);
  assert.equal(getTemplateOrBlank(null).id, BLANK_TEMPLATE_ID);
  assert.equal(getTemplateOrBlank(undefined).id, BLANK_TEMPLATE_ID);
});

test("assertTemplateCatalogCompleteness rejects invalid injected catalogs", () => {
  const originalEntries = [...TEMPLATE_CATALOG];
  const blank = getTemplate(BLANK_TEMPLATE_ID)!;
  const entries = TEMPLATE_CATALOG as TemplateEntry[];
  try {
    entries.splice(0, entries.length);
    assert.throws(
      () => assertTemplateCatalogCompleteness(),
      /Catalog must contain at least one template/,
    );

    entries.push({ ...blank, id: "" });
    assert.throws(
      () => assertTemplateCatalogCompleteness(),
      /Catalog entry is missing an id/,
    );

    entries.splice(
      0,
      entries.length,
      { ...blank, id: BLANK_TEMPLATE_ID },
      { ...blank, id: BLANK_TEMPLATE_ID },
    );
    assert.throws(
      () => assertTemplateCatalogCompleteness(),
      /Duplicate template id: blank/,
    );

    entries.splice(0, entries.length, { ...blank, name: "" });
    assert.throws(
      () => assertTemplateCatalogCompleteness(),
      /blank is missing display metadata/,
    );

    entries.splice(0, entries.length, {
      ...blank,
      content: invalidTemplateContent(123),
    });
    assert.throws(
      () => assertTemplateCatalogCompleteness(),
      /blank content must be a string/,
    );
  } finally {
    entries.splice(0, entries.length, ...originalEntries);
  }
});
