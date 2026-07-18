import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  act,
  create as createRenderer,
  type ReactTestRenderer,
} from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";

import {
  createAutosaveController,
  queueAutosaveForLexicalUpdate,
  useLexicalAutosave,
  type SaveStatus,
} from "./use-autosave";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("autosave controller debounces queued JSON and reports status", async () => {
  const statuses: SaveStatus[] = [];
  const saved: string[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const controller = createAutosaveController({
    save: async (json) => {
      saved.push(json);
      return { ok: true };
    },
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => {
      throw error;
    },
    setTimer: ((callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    }) as typeof setTimeout,
    clearTimer: ((id: number) => {
      timers.delete(id);
    }) as typeof clearTimeout,
  });

  controller.queue("first");
  controller.queue("second");

  assert.equal(timers.size, 1);
  const callback = timers.values().next().value;
  assert.ok(callback, "expected one pending debounce callback");
  callback();
  await Promise.resolve();

  assert.deepEqual(saved, ["second"]);
  assert.deepEqual(statuses, ["pending", "pending", "saving", "saved"]);
  controller.dispose();
});

test("sustained updates flush at max wait without disabling debounce coalescing", async () => {
  const saved: string[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 1;
  let currentTime = 0;
  const controller = createAutosaveController({
    save: async (json) => {
      saved.push(json);
      return { ok: true };
    },
    debounceMs: 10,
    maxWaitMs: 30,
    onStatus: () => undefined,
    onError: (error) => {
      throw error;
    },
    now: () => currentTime,
    setTimer: ((callback: () => void, delay: number) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    }) as typeof setTimeout,
    clearTimer: ((id: number) => {
      timers.delete(id);
    }) as typeof clearTimeout,
  });

  controller.queue("first");
  currentTime = 8;
  controller.queue("second");
  currentTime = 16;
  controller.queue("third");
  currentTime = 25;
  controller.queue("latest");

  assert.equal(timers.size, 1);
  const pending = timers.values().next().value;
  assert.equal(pending?.delay, 5);
  pending?.callback();
  await Promise.resolve();

  assert.deepEqual(saved, ["latest"]);
  controller.dispose();
});

test("autosave controller keeps pending status when newer JSON arrives mid-save", async () => {
  const statuses: SaveStatus[] = [];
  const saves = [deferred<{ ok: true }>(), deferred<{ ok: true }>()];
  let saveIndex = 0;
  const controller = createAutosaveController({
    save: () => saves[saveIndex++].promise,
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => {
      throw error;
    },
  });

  controller.queue("first");
  const saving = controller.flush();
  controller.queue("second");
  saves[0].resolve({ ok: true });
  await Promise.resolve();
  saves[1].resolve({ ok: true });
  await saving;

  assert.deepEqual(statuses, [
    "pending",
    "saving",
    "pending",
    "saving",
    "saved",
  ]);
  assert.equal(controller.latestJson(), "second");
  controller.dispose();
});

test("a newer generation with identical JSON still waits for its own save", async () => {
  const statuses: SaveStatus[] = [];
  const saves = [deferred<{ ok: true }>(), deferred<{ ok: true }>()];
  let saveIndex = 0;
  const controller = createAutosaveController({
    save: () => saves[saveIndex++].promise,
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => {
      throw error;
    },
  });

  controller.queue("same");
  const saving = controller.flush();
  controller.queue("same");
  saves[0].resolve({ ok: true });
  await Promise.resolve();

  assert.deepEqual(statuses, ["pending", "saving", "pending", "saving"]);
  saves[1].resolve({ ok: true });
  await saving;

  assert.deepEqual(statuses, [
    "pending",
    "saving",
    "pending",
    "saving",
    "saved",
  ]);
  controller.dispose();
});

test("autosave snapshots the reconciled editor state after the update callback", async () => {
  const statuses: SaveStatus[] = [];
  const saved: string[] = [];
  const microtasks: Array<() => void> = [];
  let liveJson = "local-update";
  const controller = createAutosaveController({
    save: async (json) => {
      saved.push(json);
      return { ok: true };
    },
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => {
      throw error;
    },
    scheduleMicrotask: (callback) => microtasks.push(callback),
  });
  const editor = {
    getEditorState: () => ({ toJSON: () => liveJson }),
  } as unknown as LexicalEditor;

  queueAutosaveForLexicalUpdate({
    controller,
    editor,
    tags: new Set(),
    shouldAutosaveUpdate: () => true,
  });
  assert.deepEqual(statuses, ["pending"]);

  liveJson = "collaboration-reconciled";
  microtasks.shift()?.();
  await controller.flush();

  assert.deepEqual(saved, ['"collaboration-reconciled"']);
  assert.deepEqual(statuses, ["pending", "saving", "saved"]);
  controller.dispose();
});

test("rapid table structure and cell updates coalesce into one durable 3x3 snapshot", async () => {
  const editor = createHeadlessEditor({
    namespace: "autosave-table",
    nodes: [TableNode, TableRowNode, TableCellNode],
    onError: (error) => {
      throw error;
    },
  });
  const saved: string[] = [];
  const controller = createAutosaveController({
    save: async (json) => {
      saved.push(json);
      return { ok: true };
    },
    debounceMs: 10,
    onStatus: () => undefined,
    onError: (error) => {
      throw error;
    },
  });
  const queueUpdate = () =>
    queueAutosaveForLexicalUpdate({
      controller,
      editor,
      tags: new Set(),
      shouldAutosaveUpdate: () => true,
    });

  editor.update(
    () => {
      $getRoot().append($createTableNodeWithDimensions(2, 2, true));
    },
    { discrete: true },
  );
  queueUpdate();

  const values = [
    "Region",
    "Quarter",
    "Revenue",
    "North",
    "Q1",
    "$12M",
    "South",
    "Q2",
    "$9M",
  ];
  editor.update(
    () => {
      const table = $createTableNodeWithDimensions(3, 3, true);
      $getRoot().clear().append(table);
      let valueIndex = 0;
      for (const row of table.getChildren()) {
        assert.ok($isTableRowNode(row));
        for (const cell of row.getChildren()) {
          assert.ok($isTableCellNode(cell));
          cell
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode(values[valueIndex++] ?? ""),
              ),
            );
        }
      }
    },
    { discrete: true },
  );
  queueUpdate();

  await Promise.resolve();
  await controller.flush();

  assert.equal(saved.length, 1);
  const root = JSON.parse(saved[0]!).root as {
    children: Array<{
      children: Array<{
        children: Array<{
          children: Array<{ children: Array<{ text: string }> }>;
        }>;
      }>;
    }>;
  };
  const table = root.children[0]!;
  assert.equal(table.children.length, 3);
  assert.deepEqual(
    table.children.flatMap((row) =>
      row.children.map((cell) => cell.children[0]!.children[0]!.text),
    ),
    values,
  );
  editor.getEditorState().read(() => {
    assert.ok($isTableNode($getRoot().getFirstChild()));
  });
  controller.dispose();
});

test("autosave controller ignores stale failed completion after newer JSON", async () => {
  const statuses: SaveStatus[] = [];
  const errors: unknown[] = [];
  const first = deferred<{ ok: boolean; error?: string }>();
  const second = deferred<{ ok: boolean }>();
  const saved: string[] = [];

  const controller = createAutosaveController({
    save: (json) => {
      saved.push(json);
      return saved.length === 1 ? first.promise : second.promise;
    },
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
  });

  controller.queue("first");
  const firstFlush = controller.flush();
  controller.queue("second");
  first.resolve({ ok: false, error: "stale failure" });
  await Promise.resolve();

  assert.deepEqual(errors, []);
  assert.deepEqual(statuses, ["pending", "saving", "pending", "saving"]);
  second.resolve({ ok: true });
  await firstFlush;

  assert.deepEqual(saved, ["first", "second"]);
  assert.deepEqual(statuses, [
    "pending",
    "saving",
    "pending",
    "saving",
    "saved",
  ]);
  controller.dispose();
});

test("autosave controller suppresses callbacks after dispose", async () => {
  const statuses: SaveStatus[] = [];
  const errors: unknown[] = [];
  const save = deferred<{ ok: false; error: string }>();
  const controller = createAutosaveController({
    save: () => save.promise,
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
  });

  controller.queue("first");
  const flushing = controller.flush();
  controller.dispose();
  save.resolve({ ok: false, error: "late failure" });
  await flushing;

  assert.deepEqual(statuses, ["pending", "saving"]);
  assert.deepEqual(errors, []);
});

test("autosave controller reports failed save results and thrown errors", async () => {
  const statuses: SaveStatus[] = [];
  const errors: unknown[] = [];
  const controller = createAutosaveController({
    save: async (json) =>
      json === "failed-result"
        ? { ok: false, error: "backend rejected save" }
        : Promise.reject(new Error("network unavailable")),
    debounceMs: 10,
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
  });

  controller.queue("failed-result");
  await controller.flush();
  controller.queue("throws");
  await controller.flush();

  assert.deepEqual(statuses, [
    "pending",
    "saving",
    "error",
    "pending",
    "saving",
    "error",
  ]);
  assert.equal(errors[0], "backend rejected save");
  assert.match(String(errors[1]), /network unavailable/);
  controller.dispose();
});

test("autosave controller debounce timer starts a flush", async () => {
  const statuses: SaveStatus[] = [];
  const saved: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const controller = createAutosaveController({
      save: async (json) => {
        saved.push(json);
        return { ok: true };
      },
      debounceMs: 0,
      onStatus: (status) => {
        statuses.push(status);
        if (status === "saved") {
          controller.dispose();
          resolve();
        }
      },
      onError: reject,
    });
    controller.queue("timer-json");
  });

  assert.deepEqual(saved, ["timer-json"]);
  assert.deepEqual(statuses, ["pending", "saving", "saved"]);
});

test("useLexicalAutosave exposes saved status before its lifecycle controller mounts", () => {
  let shouldAutosaveTags: Set<string> | null = null;
  function Probe() {
    const { status, handleChange } = useLexicalAutosave({
      save: async () => ({ ok: true }),
      shouldAutosaveUpdate(tags) {
        shouldAutosaveTags = tags;
        return false;
      },
      debounceMs: 1,
    });
    handleChange(
      { toJSON: () => ({ root: { children: [] } }) } as never,
      null as unknown as LexicalEditor,
      new Set(["history-merge"]),
    );
    return createElement("span", null, status);
  }

  assert.equal(
    renderToStaticMarkup(createElement(Probe)),
    "<span>saved</span>",
  );
  assert.equal(shouldAutosaveTags, null);
});

test("useLexicalAutosave remains active after StrictMode effect replay", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let handleChange:
    | ReturnType<typeof useLexicalAutosave>["handleChange"]
    | null = null;
  const saved: string[] = [];
  let renderer: ReactTestRenderer | null = null;

  function Probe() {
    handleChange = useLexicalAutosave({
      save: async (json) => {
        saved.push(json);
        return { ok: true };
      },
      shouldAutosaveUpdate: () => true,
      debounceMs: 0,
    }).handleChange;
    return null;
  }

  await act(async () => {
    renderer = createRenderer(
      createElement(StrictMode, null, createElement(Probe)),
    );
  });
  const editor = {
    getEditorState: () => ({
      toJSON: () => ({ root: { children: ["latest"] } }),
    }),
  } as unknown as LexicalEditor;

  await act(async () => {
    handleChange?.(
      { toJSON: () => ({ root: { children: ["callback"] } }) } as never,
      editor,
      new Set(),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  assert.deepEqual(saved, ['{"root":{"children":["latest"]}}']);
  act(() => renderer?.unmount());
});
