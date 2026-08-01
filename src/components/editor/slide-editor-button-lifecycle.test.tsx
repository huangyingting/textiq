import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";
import { act, create } from "react-test-renderer";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { withDefaultDom } from "@/test/react-render-harness";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

type LifecycleState = {
  exportImpl: () => Promise<Blob | null>;
  downloads: Array<{ blob: Blob; filename: string }>;
  hookMounts: string[];
  hookUnmounts: string[];
  openState: Record<string, unknown>;
};

declare global {
  var __slideEditorButtonLifecycleState: LifecycleState;
}

const stubPrefix = "slide-editor-button-lifecycle:test:";
const stubSources = new Map<string, string>([
  [
    "@/components/editor/use-slide-editor-open",
    `import { useEffect } from "react";
    export function useSlideEditorOpen({ documentId }) {
      useEffect(() => {
        globalThis.__slideEditorButtonLifecycleState.hookMounts.push(documentId);
        return () => {
          globalThis.__slideEditorButtonLifecycleState.hookUnmounts.push(documentId);
        };
      }, []);
      return globalThis.__slideEditorButtonLifecycleState.openState;
    }`,
  ],
  [
    "@/components/presentation/slide-editor",
    `export function SlideEditor() { return null; }`,
  ],
  ["react-dom", `export function createPortal(children) { return children; }`],
  [
    "@/lib/presentation/pptx-apply",
    `export async function exportDeckAsPPTX() {
      return globalThis.__slideEditorButtonLifecycleState.exportImpl();
    }`,
  ],
  [
    "@/lib/visual/export",
    `export function downloadBlob(blob, filename) {
      globalThis.__slideEditorButtonLifecycleState.downloads.push({ blob, filename });
    }`,
  ],
]);

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubSources.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubSources.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

let SlideEditorButton: typeof import("./slide-editor-button").SlideEditorButton;

function baseOpenState(): Record<string, unknown> {
  return {
    open: true,
    deck: buildMinimalDeck(),
    deckOpenDiagnostics: [],
    deckOpenError: null,
    saveStatus: "saved",
    saveStatusLabel: "All changes saved",
    saveErrorMessage: undefined,
    hasUnsavedWork: false,
    handleDeckChange: () => undefined,
    handleSave: async () => ({ ok: true, data: undefined }),
    handleUndo: () => undefined,
    handleRedo: () => undefined,
    undoRedoFocus: null,
    canUndo: false,
    canRedo: false,
    handleOpen: () => undefined,
    handleClose: () => undefined,
    aiEnabled: false,
    pendingJson: null,
    pendingThemePackageId: null,
    emptyDocument: false,
    handleOpenDialogApply: () => undefined,
    handleOpenDialogDerive: () => undefined,
    handleOpenDialogClose: () => undefined,
    aiPreview: null,
    handleAiPreviewApply: () => undefined,
    handleAiPreviewDerive: () => undefined,
    handleAiPreviewCancel: () => undefined,
    conflictState: null,
    handleConflictKeepMine: async () => undefined,
    handleConflictUseTheirs: async () => undefined,
    handleConflictDismiss: () => undefined,
  };
}

before(async () => {
  ({ SlideEditorButton } = await import("./slide-editor-button"));
});

beforeEach(() => {
  globalThis.__slideEditorButtonLifecycleState = {
    exportImpl: async () => new Blob(["pptx"]),
    downloads: [],
    hookMounts: [],
    hookUnmounts: [],
    openState: baseOpenState(),
  };
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("SlideEditorButton ignores a PPTX renderer that settles after unmount", async () => {
  await withDefaultDom(async () => {
    Object.assign(document, {
      body: { style: {} },
      documentElement: { style: {} },
    });
    const exportAttempt = deferred<Blob | null>();
    globalThis.__slideEditorButtonLifecycleState.exportImpl = () =>
      exportAttempt.promise;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <SlideEditorButton
          documentId="doc-overlay-export"
          initialDeckJson={null}
          deckPort={{} as never}
        />,
      );
    });
    const editor = renderer.root.find(
      (node) => typeof node.props.onExportPptx === "function",
    );
    const settled = (editor.props.onExportPptx as () => Promise<void>)();
    assert.equal(
      globalThis.__slideEditorButtonLifecycleState.downloads.length,
      0,
    );

    act(() => renderer.unmount());
    exportAttempt.resolve(new Blob(["late-pptx"]));
    await settled;

    assert.equal(
      globalThis.__slideEditorButtonLifecycleState.downloads.length,
      0,
    );
  });
});

test("switching documents remounts the slide-editor controller at the operation identity boundary", () => {
  globalThis.__slideEditorButtonLifecycleState.openState = {
    ...baseOpenState(),
    open: false,
    deck: null,
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <SlideEditorButton
        documentId="doc-old"
        initialDeckJson={null}
        deckPort={{} as never}
      />,
    );
  });

  try {
    assert.deepEqual(globalThis.__slideEditorButtonLifecycleState.hookMounts, [
      "doc-old",
    ]);
    act(() => {
      renderer.update(
        <SlideEditorButton
          documentId="doc-new"
          initialDeckJson={null}
          deckPort={{} as never}
        />,
      );
    });

    assert.deepEqual(globalThis.__slideEditorButtonLifecycleState.hookMounts, [
      "doc-old",
      "doc-new",
    ]);
    assert.deepEqual(
      globalThis.__slideEditorButtonLifecycleState.hookUnmounts,
      ["doc-old"],
    );
  } finally {
    act(() => renderer.unmount());
  }
});
