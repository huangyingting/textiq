import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  runVisualPickerMutation,
  VISUAL_PICKER_FAILURE_MESSAGE,
} from "./visual-picker-recovery";

describe("runVisualPickerMutation", () => {
  test("returns failed and skips mutation callback when picker rejects", async () => {
    const mutations: string[] = [];
    const result = await runVisualPickerMutation({
      onPickVisual: async () => {
        throw new Error("bridge failed");
      },
      onPicked: () => mutations.push("mutated"),
    });

    assert.equal(result, "failed");
    assert.equal(
      VISUAL_PICKER_FAILURE_MESSAGE,
      "Visual picker failed. Please try again.",
    );
    assert.deepEqual(mutations, []);
  });

  test("returns cancelled and skips mutation callback when picker is dismissed", async () => {
    const mutations: string[] = [];
    const result = await runVisualPickerMutation({
      onPickVisual: async () => undefined,
      onPicked: () => mutations.push("mutated"),
    });

    assert.equal(result, "cancelled");
    assert.deepEqual(mutations, []);
  });

  test("returns picked and invokes mutation callback when picker resolves", async () => {
    const pickedValues: Array<{ visualId: string }> = [];
    const result = await runVisualPickerMutation({
      onPickVisual: async () => ({ visualId: "visual-1" }),
      onPicked: (picked) => pickedValues.push(picked),
    });

    assert.equal(result, "picked");
    assert.deepEqual(pickedValues, [{ visualId: "visual-1" }]);
  });
});
