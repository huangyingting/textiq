import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSingleCommitGesture } from "./single-commit-gesture";

describe("createSingleCommitGesture", () => {
  test("commits the final draft once on finish", () => {
    const previews: Array<number | null> = [];
    const commits: number[] = [];
    const gesture = createSingleCommitGesture({
      initialValue: 10,
      onPreview: (value) => previews.push(value),
      onCommit: (value) => commits.push(value),
    });

    gesture.update(12);
    gesture.update(15);
    gesture.finish();

    assert.deepEqual(previews, [12, 15, null]);
    assert.deepEqual(commits, [15]);
  });

  test("does not commit unchanged value", () => {
    const commits: string[] = [];
    const gesture = createSingleCommitGesture({
      initialValue: "same",
      onPreview: () => undefined,
      onCommit: (value) => commits.push(value),
    });

    gesture.update("same");
    gesture.finish();

    assert.deepEqual(commits, []);
  });

  test("ignores duplicate finish calls", () => {
    const commits: number[] = [];
    const gesture = createSingleCommitGesture({
      initialValue: 0,
      onPreview: () => undefined,
      onCommit: (value) => commits.push(value),
    });

    gesture.update(42);
    gesture.finish();
    gesture.finish();

    assert.deepEqual(commits, [42]);
  });
});
