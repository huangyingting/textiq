import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACCOUNT_EXPORT_USAGE_LEDGER_FIELDS } from "@/lib/account/export";
import {
  PERSONAL_DATA_EXPORT_SECTIONS,
  PERSONAL_DATA_INVENTORY,
  inventoryExportSections,
} from "@/lib/privacy/personal-data-inventory";

function parseSchemaFields(schema: string): Map<string, string[]> {
  const models = new Map<string, string[]>();
  const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^}/gm;
  for (const match of schema.matchAll(modelRe)) {
    const [, modelName, body] = match;
    const fields = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith("//") &&
          !line.startsWith("/*") &&
          !line.startsWith("*") &&
          !line.startsWith("@@"),
      )
      .map((line) => line.split(/\s+/)[0])
      .filter((field) => field && !field.startsWith("@"));
    models.set(modelName, fields);
  }
  return models;
}

test("personal-data inventory classifies every Prisma model field", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const schemaModels = parseSchemaFields(schema);
  const inventoryModels = new Map<string, string[]>(
    PERSONAL_DATA_INVENTORY.map((entry) => [
      entry.model,
      Object.keys(entry.fields).sort(),
    ]),
  );

  assert.deepEqual(
    Array.from(inventoryModels.keys()).sort(),
    Array.from(schemaModels.keys()).sort(),
  );

  for (const [model, schemaFields] of schemaModels) {
    assert.deepEqual(
      inventoryModels.get(model),
      schemaFields.toSorted(),
      `${model} inventory fields must match schema fields`,
    );
  }
});

test("account export manifest sections stay synced to exportable inventory", () => {
  assert.deepEqual(
    [...PERSONAL_DATA_EXPORT_SECTIONS].sort(),
    inventoryExportSections(),
  );
});

test("usageLedger export fields stay in sync with inventory and exclude keyHash", () => {
  const usageLedgerInventory = PERSONAL_DATA_INVENTORY.find(
    (entry) => entry.model === "UsageLedgerEntry",
  );
  assert.ok(usageLedgerInventory);

  const exportedUsageLedgerFields = Object.entries(usageLedgerInventory.fields)
    .flatMap(([field, inventory]) =>
      inventory.exportSection === "usageLedger" ? [field] : [],
    )
    .sort();

  assert.deepEqual(
    exportedUsageLedgerFields,
    [...ACCOUNT_EXPORT_USAGE_LEDGER_FIELDS].sort(),
  );
  assert.equal(usageLedgerInventory.fields.keyHash.exportSection, undefined);
});
