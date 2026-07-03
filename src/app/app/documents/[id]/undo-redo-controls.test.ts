import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalUndoBaselineJson,
  matchesProtectedUndoBaseline,
} from "./undo-redo-controls";

test("undo baseline comparison ignores runtime block ids", () => {
  const initial = {
    root: {
      children: [
        {
          children: [{ text: "Roadmap", type: "text", version: 1 }],
          type: "heading",
          version: 1,
        },
      ],
      type: "root",
      version: 1,
    },
  };
  const current = {
    root: {
      children: [
        {
          bid: "block-runtime-1",
          children: [{ text: "Roadmap", type: "text", version: 1 }],
          type: "heading",
          version: 1,
        },
      ],
      type: "root",
      version: 1,
    },
  };

  assert.equal(
    canonicalUndoBaselineJson(initial),
    canonicalUndoBaselineJson(current),
  );
  assert.equal(
    matchesProtectedUndoBaseline(current, JSON.stringify(initial)),
    true,
  );
});

test("undo baseline comparison rejects edited template content", () => {
  const initial = {
    root: {
      children: [
        {
          children: [{ text: "Roadmap", type: "text", version: 1 }],
          type: "paragraph",
          version: 1,
        },
      ],
      type: "root",
      version: 1,
    },
  };
  const edited = {
    root: {
      children: [
        {
          bid: "block-runtime-1",
          children: [{ text: "Roadmap updated", type: "text", version: 1 }],
          type: "paragraph",
          version: 1,
        },
      ],
      type: "root",
      version: 1,
    },
  };

  assert.equal(
    matchesProtectedUndoBaseline(edited, JSON.stringify(initial)),
    false,
  );
});

test("blank documents protect the empty editor baseline only", () => {
  assert.equal(
    matchesProtectedUndoBaseline({ root: { children: [] } }, null),
    true,
  );
  assert.equal(
    matchesProtectedUndoBaseline(
      {
        root: {
          children: [
            { bid: "block-runtime-1", children: [], type: "paragraph" },
          ],
        },
      },
      null,
    ),
    true,
  );
  assert.equal(
    matchesProtectedUndoBaseline(
      {
        root: {
          children: [
            {
              children: [{ text: "User text", type: "text", version: 1 }],
              type: "paragraph",
            },
          ],
        },
      },
      null,
    ),
    false,
  );
});
