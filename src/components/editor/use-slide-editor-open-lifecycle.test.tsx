import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

import "@/test/react-render-harness";

import type { DeckActionPort } from "@/lib/action-ports";
import type { FetchDeckResult } from "@/lib/document/persistence-types";
import { createBlankDeck } from "@/lib/presentation/empty-deck";

import { useSlideEditorOpen } from "./use-slide-editor-open";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "use-slide-editor-open-lifecycle-test",
    onError(error) {
      throw error;
    },
  });
}

function composerContextFor(
  editor: LexicalEditor,
): LexicalComposerContextWithEditor {
  return [editor, createLexicalComposerContext(null, null)];
}

type OpenController = ReturnType<typeof useSlideEditorOpen>;

function mountOpenController({
  deckPort,
  onOpenRightSurface = () => undefined,
}: {
  deckPort: DeckActionPort;
  onOpenRightSurface?: () => void;
}) {
  const editor = makeEditor();
  let controller: OpenController | undefined;

  function Probe() {
    controller = useSlideEditorOpen({
      documentId: "doc-open-lifecycle",
      initialDeckJson: null,
      deckPort,
      onOpenRightSurface,
    });
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContextFor(editor) },
        createElement(Probe),
      ),
    );
  });

  return {
    get controller() {
      assert.ok(controller, "expected the open controller to be mounted");
      return controller;
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

test("useSlideEditorOpen claims a repeated open activation before awaiting the deck fetch", async () => {
  const fetches: Array<ReturnType<typeof deferred<FetchDeckResult>>> = [];
  const deckPort: DeckActionPort = {
    fetchDeckJson: async () => {
      const fetch = deferred<FetchDeckResult>();
      fetches.push(fetch);
      return await fetch.promise;
    },
    saveDeckJson: async () => ({ ok: true, revisionToken: "saved" }),
  };
  const mounted = mountOpenController({ deckPort });
  let firstOpen!: Promise<void>;
  let repeatedOpen!: Promise<void>;

  try {
    act(() => {
      firstOpen = mounted.controller.handleOpen();
      repeatedOpen = mounted.controller.handleOpen();
    });

    assert.equal(
      fetches.length,
      1,
      "a repeated activation must not start a competing deck fetch",
    );
    assert.equal(
      (
        mounted.controller as OpenController & {
          openPreparing?: boolean;
        }
      ).openPreparing,
      true,
      "the owned fetch must expose pending state to the toolbar trigger",
    );
  } finally {
    const result: FetchDeckResult = {
      ok: true,
      deckJson: createBlankDeck({ documentId: "doc-open-lifecycle" }),
      revisionToken: "rev-open",
      themeDiagnostics: [],
    };
    for (const fetch of fetches) fetch.resolve(result);
    await act(async () => {
      await Promise.all([firstOpen, repeatedOpen]);
    });
    assert.equal(mounted.controller.openPreparing, false);
    mounted.unmount();
  }
});

test("useSlideEditorOpen ignores an open fetch that settles after unmount", async () => {
  const fetch = deferred<FetchDeckResult>();
  let openedSurfaces = 0;
  const mounted = mountOpenController({
    deckPort: {
      fetchDeckJson: () => fetch.promise,
      saveDeckJson: async () => ({ ok: true, revisionToken: "saved" }),
    },
    onOpenRightSurface: () => {
      openedSurfaces += 1;
    },
  });
  let pendingOpen!: Promise<void>;

  act(() => {
    pendingOpen = mounted.controller.handleOpen();
  });
  mounted.unmount();
  fetch.resolve({
    ok: true,
    deckJson: createBlankDeck({ documentId: "doc-open-lifecycle" }),
    revisionToken: "rev-late-open",
    themeDiagnostics: [],
  });
  await pendingOpen;

  assert.equal(
    openedSurfaces,
    0,
    "a detached editor must not open an external surface from a late fetch",
  );
});

test("cancelling AI generation prevents a pending baseline fetch from opening a preview", async () => {
  const previousAiDeckFlag = process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
  process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = "true";
  const baselineFetch = deferred<FetchDeckResult>();
  const initialDeck = createBlankDeck({ documentId: "doc-open-lifecycle" });
  let fetchCalls = 0;
  const mounted = mountOpenController({
    deckPort: {
      fetchDeckJson: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return {
            ok: true,
            deckJson: initialDeck,
            revisionToken: "rev-initial",
            themeDiagnostics: [],
          };
        }
        return await baselineFetch.promise;
      },
      saveDeckJson: async () => ({ ok: true, revisionToken: "saved" }),
    },
  });

  try {
    assert.equal(mounted.controller.aiEnabled, true);
    await act(async () => {
      await mounted.controller.handleOpen();
    });
    assert.equal(fetchCalls, 1);
    assert.notEqual(mounted.controller.pendingJson, null);

    act(() => {
      mounted.controller.handleOpenDialogApply({
        deck: createBlankDeck({ documentId: "generated-preview" }),
        truncated: false,
        diagnostics: [],
        options: {},
      });
    });
    assert.equal(fetchCalls, 2);
    assert.equal(
      (
        mounted.controller as OpenController & {
          aiPreviewPreparing?: boolean;
        }
      ).aiPreviewPreparing,
      true,
      "baseline preparation must expose pending ownership to the dialog",
    );
    act(() => {
      mounted.controller.handleOpenDialogClose();
    });
    assert.equal(mounted.controller.pendingJson, null);
    assert.equal(mounted.controller.aiPreviewPreparing, false);

    baselineFetch.resolve({
      ok: true,
      deckJson: initialDeck,
      revisionToken: "rev-baseline",
      themeDiagnostics: [],
    });
    await act(async () => {
      await baselineFetch.promise;
      await waitForAsyncDrain();
    });

    assert.equal(
      mounted.controller.aiPreview,
      null,
      "a cancelled generation must not publish its late preview",
    );
  } finally {
    mounted.unmount();
    if (previousAiDeckFlag === undefined) {
      delete process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = previousAiDeckFlag;
    }
  }
});

test("the newest AI preview preparation owns out-of-order baseline completions", async () => {
  const previousAiDeckFlag = process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
  process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = "true";
  const firstBaseline = deferred<FetchDeckResult>();
  const secondBaseline = deferred<FetchDeckResult>();
  const initialDeck = createBlankDeck({ documentId: "doc-open-lifecycle" });
  let fetchCalls = 0;
  const mounted = mountOpenController({
    deckPort: {
      fetchDeckJson: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return {
            ok: true,
            deckJson: initialDeck,
            revisionToken: "rev-initial",
            themeDiagnostics: [],
          };
        }
        if (fetchCalls === 2) return await firstBaseline.promise;
        return await secondBaseline.promise;
      },
      saveDeckJson: async () => ({ ok: true, revisionToken: "saved" }),
    },
  });
  const firstProposal = createBlankDeck({ documentId: "proposal-first" });
  const secondProposal = createBlankDeck({ documentId: "proposal-second" });

  try {
    await act(async () => {
      await mounted.controller.handleOpen();
    });
    act(() => {
      mounted.controller.handleOpenDialogApply({
        deck: firstProposal,
        truncated: false,
        diagnostics: [],
        options: {},
      });
      mounted.controller.handleOpenDialogApply({
        deck: secondProposal,
        truncated: false,
        diagnostics: [],
        options: {},
      });
    });
    assert.equal(fetchCalls, 3);

    secondBaseline.resolve({
      ok: true,
      deckJson: initialDeck,
      revisionToken: "rev-second-baseline",
      themeDiagnostics: [],
    });
    await act(async () => {
      await secondBaseline.promise;
      await waitForAsyncDrain();
    });
    assert.equal(mounted.controller.aiPreview?.proposedDeck, secondProposal);

    firstBaseline.resolve({
      ok: true,
      deckJson: initialDeck,
      revisionToken: "rev-first-baseline",
      themeDiagnostics: [],
    });
    await act(async () => {
      await firstBaseline.promise;
      await waitForAsyncDrain();
    });
    assert.equal(
      mounted.controller.aiPreview?.proposedDeck,
      secondProposal,
      "an older baseline completion must not replace the newest preview",
    );
  } finally {
    firstBaseline.resolve({
      ok: true,
      deckJson: initialDeck,
      revisionToken: "rev-first-cleanup",
      themeDiagnostics: [],
    });
    secondBaseline.resolve({
      ok: true,
      deckJson: initialDeck,
      revisionToken: "rev-second-cleanup",
      themeDiagnostics: [],
    });
    await waitForAsyncDrain();
    mounted.unmount();
    if (previousAiDeckFlag === undefined) {
      delete process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = previousAiDeckFlag;
    }
  }
});

test("an AI baseline failure settling after unmount cannot open recovery", async () => {
  const previousAiDeckFlag = process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
  process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = "true";
  const baselineFetch = deferred<FetchDeckResult>();
  const initialDeck = createBlankDeck({ documentId: "doc-open-lifecycle" });
  let fetchCalls = 0;
  let openedSurfaces = 0;
  const mounted = mountOpenController({
    deckPort: {
      fetchDeckJson: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return {
            ok: true,
            deckJson: initialDeck,
            revisionToken: "rev-initial",
            themeDiagnostics: [],
          };
        }
        return await baselineFetch.promise;
      },
      saveDeckJson: async () => ({ ok: true, revisionToken: "saved" }),
    },
    onOpenRightSurface: () => {
      openedSurfaces += 1;
    },
  });

  try {
    await act(async () => {
      await mounted.controller.handleOpen();
    });
    act(() => {
      mounted.controller.handleOpenDialogApply({
        deck: createBlankDeck({ documentId: "proposal-late" }),
        truncated: false,
        diagnostics: [],
        options: {},
      });
    });
    assert.equal(fetchCalls, 2);

    mounted.unmount();
    baselineFetch.resolve({
      ok: false,
      deckJson: null,
      revisionToken: null,
      error: "late baseline failure",
      failure: { code: "storage_unavailable", retryable: true },
    });
    await baselineFetch.promise;
    await waitForAsyncDrain();

    assert.equal(
      openedSurfaces,
      0,
      "a detached dialog must not open recovery from a late baseline failure",
    );
  } finally {
    baselineFetch.resolve({
      ok: false,
      deckJson: null,
      revisionToken: null,
      error: "cleanup",
      failure: { code: "storage_unavailable", retryable: true },
    });
    await waitForAsyncDrain();
    if (previousAiDeckFlag === undefined) {
      delete process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_AI_DECK_GEN_ENABLED = previousAiDeckFlag;
    }
  }
});
