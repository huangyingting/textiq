import assert from "node:assert/strict";
import test from "node:test";

import type { DeckActionPort } from "@/lib/action-ports";
import type { DeckGenerationOptions } from "@/lib/ai/use-deck-generation";
import type {
  FetchDeckResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { Deck } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildSlide,
  buildTextContent,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { renderWithReact } from "@/test/react-server-renderer";

import {
  resolveDeckSaveRejectionError,
  useSlideEditorOpen,
} from "./use-slide-editor-open";

type EffectSlot = {
  deps?: readonly unknown[];
  cleanup?: () => void;
};

type MemoSlot<T> = {
  deps?: readonly unknown[];
  value: T;
};

type HookResult = ReturnType<typeof useSlideEditorOpen>;

function depsChanged(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function createHookRenderer(editorJson: unknown) {
  const slots: unknown[] = [];
  const cleanups = new Set<() => void>();

  return {
    run<T>(render: () => T): T {
      let hookIndex = 0;
      return renderWithReact(
        {
          useState: <S>(initial: S | (() => S)) => {
            const slot = hookIndex++;
            if (!(slot in slots)) {
              slots[slot] =
                typeof initial === "function"
                  ? (initial as () => S)()
                  : initial;
            }
            const setState = (next: S | ((previousValue: S) => S)) => {
              const previousValue = slots[slot] as S;
              slots[slot] =
                typeof next === "function"
                  ? (next as (previousValue: S) => S)(previousValue)
                  : next;
            };
            return [slots[slot] as S, setState] as const;
          },
          useReducer: <S, A>(
            reducer: (state: S, action: A) => S,
            initial: S,
          ) => {
            const slot = hookIndex++;
            if (!(slot in slots)) slots[slot] = initial;
            const dispatch = (action: A) => {
              slots[slot] = reducer(slots[slot] as S, action);
            };
            return [slots[slot] as S, dispatch] as const;
          },
          useRef: <T>(initial: T) => {
            const slot = hookIndex++;
            if (!(slot in slots)) slots[slot] = { current: initial };
            return slots[slot] as { current: T };
          },
          useMemo: <T>(factory: () => T, deps?: readonly unknown[]) => {
            const slot = hookIndex++;
            const previousMemo = slots[slot] as MemoSlot<T> | undefined;
            if (!previousMemo || depsChanged(previousMemo.deps, deps)) {
              const nextMemo: MemoSlot<T> = { deps, value: factory() };
              slots[slot] = nextMemo;
              return nextMemo.value;
            }
            return previousMemo.value;
          },
          useCallback: <T>(callback: T, deps?: readonly unknown[]) => {
            const slot = hookIndex++;
            const previousMemo = slots[slot] as MemoSlot<T> | undefined;
            if (!previousMemo || depsChanged(previousMemo.deps, deps)) {
              const nextMemo: MemoSlot<T> = { deps, value: callback };
              slots[slot] = nextMemo;
              return nextMemo.value;
            }
            return previousMemo.value;
          },
          useId: () => `fake-id-${hookIndex++}`,
          useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
            const slot = hookIndex++;
            const previousEffect = slots[slot] as EffectSlot | undefined;
            if (previousEffect && !depsChanged(previousEffect.deps, deps))
              return;
            previousEffect?.cleanup?.();
            if (previousEffect?.cleanup)
              cleanups.delete(previousEffect.cleanup);
            const cleanup = effect() ?? undefined;
            if (cleanup) cleanups.add(cleanup);
            slots[slot] = { deps, cleanup };
          },
          useLayoutEffect: () => {
            hookIndex++;
          },
          useInsertionEffect: () => {
            hookIndex++;
          },
          useContext: () => {
            hookIndex++;
            return [
              {
                getEditorState: () => ({
                  toJSON: () => editorJson,
                }),
              },
              { getTheme: () => null },
            ];
          },
          useTransition: () => {
            hookIndex++;
            return [false, (callback?: () => void) => callback?.()] as const;
          },
          useDeferredValue: <T>(value: T) => {
            hookIndex++;
            return value;
          },
          useSyncExternalStore: <T>(
            _subscribe: () => () => void,
            getSnapshot: () => T,
          ) => {
            hookIndex++;
            return getSnapshot();
          },
          useImperativeHandle: () => {
            hookIndex++;
          },
          useDebugValue: () => {
            hookIndex++;
          },
        },
        render,
      );
    },
    cleanup() {
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    },
  };
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
}

function nonEmptyEditorJson(title: string = "Quarterly plan") {
  return {
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          children: [{ type: "text", text: title }],
        },
        {
          type: "paragraph",
          children: [{ type: "text", text: "Expand the pipeline." }],
        },
      ],
    },
  };
}

function emptyEditorJson() {
  return {
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text: " " }] },
      ],
    },
  };
}

function deckWithText(text: string, nodeId: string = "text-node-1"): Deck {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({
          id: nodeId,
          content: buildTextContent([text]),
        }),
      ],
      { id: "slide-1" },
    ),
  ]);
}

function diagnostic(message: string): PresentationDiagnostic {
  return {
    code: "unknown-theme-package",
    category: "theme",
    severity: "warning",
    target: { scope: "theme", themePackageId: "neutral" },
    message,
  };
}

function failure(message: string): FetchDeckResult {
  return {
    ok: false,
    deckJson: null,
    revisionToken: null,
    error: message,
    failure: { code: "storage_unavailable", retryable: true },
  };
}

function createDeckPort({
  fetchResults = [],
  saveResults = [],
}: {
  fetchResults?: Array<FetchDeckResult | Error | (() => FetchDeckResult)>;
  saveResults?: Array<
    SaveDeckResult | Error | (() => SaveDeckResult | Promise<SaveDeckResult>)
  >;
} = {}) {
  const fetchCalls: string[] = [];
  const saveCalls: Array<{
    documentId: string;
    deckJson: unknown;
    revisionToken: string | null | undefined;
  }> = [];
  const port: DeckActionPort = {
    fetchDeckJson: async (documentId) => {
      fetchCalls.push(documentId);
      const next = fetchResults.shift();
      const result = typeof next === "function" ? next() : next;
      if (result instanceof Error) throw result;
      return (
        result ?? {
          ok: true,
          deckJson: null,
          revisionToken: null,
        }
      );
    },
    saveDeckJson: async (documentId, deckJson, revisionToken) => {
      saveCalls.push({ documentId, deckJson, revisionToken });
      const next = saveResults.shift();
      const result = typeof next === "function" ? await next() : next;
      if (result instanceof Error) throw result;
      return result ?? { ok: true, revisionToken: "rev-saved" };
    },
  };

  return { port, fetchCalls, saveCalls, fetchResults, saveResults };
}

function runHook(
  renderer: ReturnType<typeof createHookRenderer>,
  options: {
    deckPort: DeckActionPort;
    initialDeckJson?: unknown;
    initialContentJson?: string | null;
    onOpenRightSurface?: () => void;
    onCloseRightSurface?: () => void;
  },
): HookResult {
  return renderer.run(() =>
    useSlideEditorOpen({
      documentId: "doc-hook",
      initialDeckJson: options.initialDeckJson ?? null,
      deckPort: options.deckPort,
      initialContentJson: options.initialContentJson,
      onOpenRightSurface: options.onOpenRightSurface,
      onCloseRightSurface: options.onCloseRightSurface,
    }),
  );
}

async function withAiFlag<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = value;
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = previous;
    }
  }
}

test("resolveDeckSaveRejectionError uses fallback text for empty errors", () => {
  assert.equal(
    resolveDeckSaveRejectionError(new Error("")),
    "Couldn't save your deck. Check your connection and retry.",
  );
  assert.equal(
    resolveDeckSaveRejectionError("disk full"),
    "Couldn't save your deck. Check your connection and retry. (disk full)",
  );
});

test("useSlideEditorOpen opens a saved presentation deck and closes cleanly", async () => {
  await withAiFlag(undefined, async () => {
    const savedDeck = deckWithText("Saved deck");
    const deckPort = createDeckPort({
      fetchResults: [
        { ok: true, deckJson: savedDeck, revisionToken: "rev-open" },
      ],
    });
    const renderer = createHookRenderer(nonEmptyEditorJson());
    let opened = 0;
    let closed = 0;
    const options = {
      deckPort: deckPort.port,
      onOpenRightSurface: () => {
        opened += 1;
      },
      onCloseRightSurface: () => {
        closed += 1;
      },
    };

    let hook = runHook(renderer, options);
    assert.equal(hook.open, false);
    await hook.handleOpen();

    hook = runHook(renderer, options);
    assert.equal(hook.open, true);
    assert.equal(hook.deck, savedDeck);
    assert.deepEqual(hook.deckOpenDiagnostics, []);
    assert.equal(hook.saveStatus, "saved");
    assert.equal(opened, 1);
    assert.deepEqual(deckPort.fetchCalls, ["doc-hook"]);

    hook.handleClose();
    hook = runHook(renderer, options);
    assert.equal(hook.open, false);
    assert.equal(hook.deck, null);
    assert.equal(hook.hasUnsavedWork, false);
    assert.equal(closed, 1);
    renderer.cleanup();
  });
});

test("useSlideEditorOpen derives a first deck from document content when no saved deck exists", async () => {
  await withAiFlag(undefined, async () => {
    const deckPort = createDeckPort({
      fetchResults: [{ ok: true, deckJson: null, revisionToken: null }],
    });
    const renderer = createHookRenderer({
      root: {
        type: "root",
        children: [
          {
            type: "heading",
            tag: "h1",
            bid: "heading-1",
            children: [{ type: "text", text: "Launch plan" }],
          },
          {
            type: "table",
            bid: "table-1",
            children: [
              {
                type: "tablerow",
                children: [
                  {
                    type: "tablecell",
                    children: [{ type: "text", text: "Need" }],
                  },
                  {
                    type: "tablecell",
                    children: [{ type: "text", text: "Owner" }],
                  },
                ],
              },
              {
                type: "tablerow",
                children: [
                  {
                    type: "tablecell",
                    children: [{ type: "text", text: "Brief" }],
                  },
                  {
                    type: "tablecell",
                    children: [{ type: "text", text: "PM" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const options = { deckPort: deckPort.port };

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);

    assert.equal(hook.open, true);
    assert.equal(hook.deckOpenError, null);
    assert.equal(hook.deck?.metadata?.sourceDocumentId, "doc-hook");
    assert.notEqual(hook.deck?.slides[0]?.id, "slide-blank-1");
    assert.ok(
      hook.deck?.slides.some((slide) =>
        slide.children.some((child) => child.type === "table"),
      ),
    );
    assert.deepEqual(deckPort.fetchCalls, ["doc-hook"]);
    renderer.cleanup();
  });
});

test("useSlideEditorOpen surfaces saved deck open failures", async () => {
  await withAiFlag(undefined, async () => {
    const renderer = createHookRenderer(nonEmptyEditorJson());
    const resultErrorPort = createDeckPort({
      fetchResults: [failure("No deck available")],
    });
    const options = { deckPort: resultErrorPort.port };

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);

    assert.equal(hook.open, true);
    assert.equal(hook.deck, null);
    assert.match(hook.deckOpenError?.error ?? "", /No deck available/);
    assert.equal(hook.saveStatus, "error");
    hook.handleClose();
    renderer.cleanup();
  });
});

test("useSlideEditorOpen stages, cancels, derives, and applies AI previews", async () => {
  await withAiFlag("true", async () => {
    const baselineDeck = deckWithText("Baseline");
    const proposedDeck = deckWithText("AI proposal");
    const appliedDeck = deckWithText("AI applied");
    const deckPort = createDeckPort({
      fetchResults: [
        { ok: true, deckJson: baselineDeck, revisionToken: "rev-baseline" },
        { ok: true, deckJson: baselineDeck, revisionToken: "rev-baseline-2" },
        { ok: true, deckJson: baselineDeck, revisionToken: "rev-baseline-3" },
      ],
      saveResults: [{ ok: true, revisionToken: "rev-ai-save" }],
    });
    const renderer = createHookRenderer(nonEmptyEditorJson("AI source"));
    const options = { deckPort: deckPort.port };
    const generationOptions: DeckGenerationOptions = { length: "short" };
    const repeatedDiagnostic = diagnostic("Unknown theme");

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);
    assert.equal(hook.aiEnabled, true);
    assert.match(hook.pendingJson ?? "", /AI source/);
    assert.equal(hook.emptyDocument, false);

    hook.handleOpenDialogApply({
      deck: proposedDeck,
      truncated: true,
      diagnostics: [repeatedDiagnostic, repeatedDiagnostic],
      options: generationOptions,
    });
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    assert.equal(hook.aiPreview?.proposedDeck, proposedDeck);
    assert.equal(hook.aiPreview?.baselineDeck, baselineDeck);
    assert.equal(hook.aiPreview?.truncated, true);
    assert.deepEqual(hook.aiPreview?.generationDiagnostics, [
      repeatedDiagnostic,
    ]);

    hook.handleAiPreviewCancel();
    hook = runHook(renderer, options);
    assert.equal(hook.aiPreview, null);

    await hook.handleOpen();
    hook = runHook(renderer, options);
    hook.handleOpenDialogApply({
      deck: proposedDeck,
      truncated: false,
      diagnostics: [],
      options: generationOptions,
    });
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    hook.handleAiPreviewDerive();
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    assert.equal(hook.open, true);
    assert.equal(hook.aiPreview, null);
    assert.ok((hook.deck?.slides.length ?? 0) > 0);

    hook.handleClose();
    hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);
    hook.handleOpenDialogApply({
      deck: proposedDeck,
      truncated: false,
      diagnostics: [],
      options: generationOptions,
    });
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    hook.handleAiPreviewApply(appliedDeck, [diagnostic("Apply diagnostic")]);
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    assert.equal(hook.open, true);
    assert.equal(hook.deck, appliedDeck);
    assert.equal(deckPort.saveCalls.length, 1);
    assert.equal(deckPort.saveCalls[0]?.deckJson, appliedDeck);
    renderer.cleanup();
  });
});

test("useSlideEditorOpen derives from initial content fallback and closes the AI dialog", async () => {
  await withAiFlag("true", async () => {
    const deckPort = createDeckPort();
    const renderer = createHookRenderer(emptyEditorJson());
    const options = {
      deckPort: deckPort.port,
      initialContentJson: JSON.stringify(nonEmptyEditorJson("Saved fallback")),
    };

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);
    assert.match(hook.pendingJson ?? "", /Saved fallback/);
    assert.equal(hook.emptyDocument, false);

    hook.handleOpenDialogClose();
    hook = runHook(renderer, options);
    assert.equal(hook.pendingJson, null);
    assert.equal(hook.emptyDocument, false);

    await hook.handleOpen();
    hook = runHook(renderer, options);
    hook.handleOpenDialogDerive();
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    assert.equal(hook.open, true);
    assert.equal(hook.deckOpenError, null);
    assert.ok((hook.deck?.slides.length ?? 0) > 0);
    renderer.cleanup();
  });
});

test("useSlideEditorOpen serializes saves and restores undo redo focus", async () => {
  await withAiFlag(undefined, async () => {
    const firstDeck = deckWithText("Original", "history-node");
    const secondDeck = deckWithText("Changed", "history-node");
    const firstSave = createDeferred<SaveDeckResult>();
    const deckPort = createDeckPort({
      fetchResults: [
        { ok: true, deckJson: firstDeck, revisionToken: "rev-history-1" },
      ],
      saveResults: [
        () => firstSave.promise,
        { ok: true, revisionToken: "rev-history-2" },
      ],
    });
    const renderer = createHookRenderer(nonEmptyEditorJson());
    const options = { deckPort: deckPort.port };

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);

    const manualSave = hook.handleSave(firstDeck);
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    hook.handleDeckChange(secondDeck);
    hook = runHook(renderer, options);
    assert.equal(hook.deck, secondDeck);
    assert.equal(hook.canUndo, true);
    assert.equal(deckPort.saveCalls.length, 1);

    firstSave.resolve({ ok: true, revisionToken: "rev-history-1b" });
    const result = await manualSave;
    assert.equal(result.ok, true);
    await waitForAsyncDrain();
    hook = runHook(renderer, options);
    assert.equal(deckPort.saveCalls.length, 2);
    assert.equal(deckPort.saveCalls[1]?.deckJson, secondDeck);

    hook.handleUndo();
    hook = runHook(renderer, options);
    assert.equal(hook.deck, firstDeck);
    assert.equal(hook.canRedo, true);
    assert.equal(hook.undoRedoFocus?.nodeId, "history-node");

    hook.handleRedo();
    hook = runHook(renderer, options);
    assert.equal(hook.deck, secondDeck);
    assert.equal(hook.undoRedoFocus?.nodeId, "history-node");
    hook.handleClose();
    renderer.cleanup();
  });
});

test("useSlideEditorOpen handles conflicts, keep-mine, and use-theirs recovery", async () => {
  await withAiFlag(undefined, async () => {
    const savedDeck = deckWithText("Server original");
    const localDeck = deckWithText("Local edit");
    const newerLocalDeck = deckWithText("Newer local edit");
    const serverDeck = deckWithText("Server reload");
    const deckPort = createDeckPort({
      fetchResults: [
        { ok: true, deckJson: savedDeck, revisionToken: "rev-start" },
        { ok: true, deckJson: serverDeck, revisionToken: "rev-server" },
        new Error("offline"),
      ],
      saveResults: [
        { ok: "conflict", serverRevisionToken: "rev-server-conflict" },
        { ok: true, revisionToken: "rev-keep-mine" },
        { ok: "conflict", serverRevisionToken: "rev-still-conflicted" },
        {
          ok: false,
          error: "Write rejected",
          failure: { code: "storage_unavailable", retryable: true },
        },
      ],
    });
    const renderer = createHookRenderer(nonEmptyEditorJson());
    const options = { deckPort: deckPort.port };

    let hook = runHook(renderer, options);
    await hook.handleOpen();
    hook = runHook(renderer, options);

    const conflictResult = await hook.handleSave(localDeck);
    assert.equal(conflictResult.ok, false);
    hook = runHook(renderer, options);
    assert.equal(hook.conflictState?.localDeck, localDeck);
    assert.match(hook.saveErrorMessage ?? "", /Save conflict/);

    hook.handleDeckChange(newerLocalDeck);
    hook = runHook(renderer, options);
    assert.equal(hook.conflictState?.localDeck, newerLocalDeck);
    assert.match(
      hook.saveErrorMessage ?? "",
      /resolve the collaboration conflict/,
    );

    await hook.handleConflictKeepMine(newerLocalDeck, "rev-server-conflict");
    hook = runHook(renderer, options);
    assert.equal(hook.conflictState, null);
    assert.equal(hook.hasUnsavedWork, false);

    await assert.rejects(
      hook.handleConflictKeepMine(localDeck, "rev-stale"),
      /Still conflicted/,
    );
    hook = runHook(renderer, options);
    assert.equal(
      hook.conflictState?.serverRevisionToken,
      "rev-still-conflicted",
    );

    await assert.rejects(
      hook.handleConflictKeepMine(localDeck, "rev-still-conflicted"),
      /Write rejected/,
    );

    await hook.handleConflictUseTheirs();
    hook = runHook(renderer, options);
    assert.equal(hook.deck, serverDeck);
    assert.equal(hook.conflictState, null);
    assert.equal(hook.hasUnsavedWork, false);

    await assert.rejects(hook.handleConflictUseTheirs(), /server version/);
    hook = runHook(renderer, options);
    assert.match(hook.saveErrorMessage ?? "", /server version/);

    hook.handleConflictDismiss();
    hook = runHook(renderer, options);
    assert.equal(hook.conflictState, null);
    hook.handleClose();
    renderer.cleanup();
  });
});
