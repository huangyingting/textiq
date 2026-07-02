import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const budgets = [
  ["src/components/presentation/slide-editor.tsx", 3400],
  ["src/components/presentation/slide-canvas.tsx", 900],
  ["src/components/presentation/inspector/inspector-shell.tsx", 1500],
  ["src/components/presentation/toolbar/context-toolbar.tsx", 2300],
];

test("slide editor composition roots stay within ownership budgets", async () => {
  for (const [file, maxLines] of budgets) {
    const source = await readFile(file, "utf8");
    const lineCount = source.split("\n").length;
    assert.ok(
      lineCount <= maxLines,
      `${file} has ${lineCount} lines; keep it <= ${maxLines} by moving owned behavior into focused slide-editor, slide-stage, or slide-inspector modules.`,
    );
  }
});
