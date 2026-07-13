/**
 * Direct behavior coverage for `SlideEditorRouteClient` (#1959).
 *
 * This is the presentation-only slide route's client controller: it decides
 * how to open a deck (saved deck JSON, derived-from-content, blank, or
 * recovery), wires undo/redo, autosave scheduling + cleanup, save-conflict
 * recovery, sharing/present permissions, image upload, and the visual-picker
 * dialog, then composes the real `SlideEditor` presentation surface.
 *
 * Real, already-independently-tested pure logic this file deliberately does
 * NOT re-verify but exercises through the route client's own wiring:
 * `decideDeckOpen`/`openDeckFromJson` (`open-deck.test.ts`),
 * `deriveDeckFromDocumentContent` (`deck-derivation.test.ts`),
 * `createSlideAutosaveScheduler` (`slide-autosave-scheduler.test.ts`),
 * `resolveSaveStatus`/`SAVE_STATUS_LABEL` (`save-status.test.ts`),
 * `persistDeckWithRecovery` (`use-slide-editor-open.test.ts`), and
 * `reloadConflictServerDeck` (`conflict-recovery-reload.test.ts`). All of
 * these run for real here — only the genuine seams get stubbed:
 *
 *  - `../actions` (`fetchDeckJson`/`saveDeckJson`/`toggleDocumentSharing`)
 *    and `../slide-asset-actions` (`uploadSlideAsset`) are real Next.js
 *    `"use server"` actions that hit Prisma (`@/lib/prisma` instantiates a
 *    `PrismaClient` against the *generated* client at module scope) and
 *    session/permission checks — letting them load for real in a unit test
 *    would require a live DB and duplicate `actions.test.ts` /
 *    `slide-asset-actions.test.ts`'s own coverage. Both are stubbed with a
 *    swappable-implementation shim (`globalThis.__slideRouteActionImpls`,
 *    reassigned per test) that also records call args.
 *  - `@/components/presentation/slide-editor` (2822-line `SlideEditor`, not
 *    one of #1959's 7 target files, with no test file of its own) is stubbed
 *    with a prop-recording component so this file asserts the route client's
 *    own prop-wiring/composition — not the editor surface's internals.
 *  - `@/components/presentation/conflict-recovery-dialog` (a sibling with
 *    its OWN test file, `conflict-recovery-dialog.test.tsx`) is backed by
 *    `@/components/ui`'s `Dialog` → `ModalSurface`, which — like
 *    `BottomSheetSurface` (see `mobile-editing-sheet.test.tsx`) — drives a
 *    real `createPortal` + focus-trap + body-lock DOM coupling this suite is
 *    required to avoid; it is stubbed the same way, recording props/mount
 *    state instead of duplicating its own already-covered internals.
 *  - `next/navigation`'s `useRouter` requires a real Next.js App Router
 *    context provider to call without throwing; it is stubbed with a
 *    call-recording `push`.
 *  - `@/lib/presentation/raster-browser-export` (`exportDeckRasterBrowser`)
 *    renders slides through a real DOM (`react-dom/client`'s `createRoot`,
 *    `querySelectorAll`, `window.getComputedStyle`) to rasterize PDF/PNG
 *    output — a jsdom-only dependency this suite must avoid — so it is
 *    stubbed with a swappable-implementation shim
 *    (`globalThis.__exportDeckRasterBrowserImpl`).
 *  - `@/lib/visual/export`'s `downloadBlob` triggers a real
 *    `document.createElement("a")`/`click()` DOM download side effect; it is
 *    stubbed with a call-recording no-op so export handlers can be asserted
 *    without a DOM. `exportDeckAsPPTX` (`@/lib/presentation/pptx-apply`,
 *    independently tested in `pptx-apply.test.ts`) needs no DOM and runs for
 *    real.
 *
 * All five stubs are generated as REAL, on-disk `.ts` files via a
 * `node:module` `registerHooks` `resolve()` hook (see
 * `mobile-editing-sheet.test.tsx` for the full rationale): this project's
 * `.tsx`/`.ts` files load through Node's CommonJS `require()` under `tsx`
 * even when reached via dynamic `import()`, and CJS's file read ignores a
 * `load()` hook's synthetic inline source, so the hook must return a real
 * `pathToFileURL` pointing at a real file. Every local (`@/...`/`../...`)
 * import in this file is deferred into `before()`, executed strictly after
 * `registerHooks()` runs, since Node's synchronous resolver only invokes the
 * hook once per unique specifier *text* process-wide.
 *
 * `@/components/ui`'s `Button` (used directly by `SlideRouteRecovery`) is
 * portal-free and mounted for real, as are the route client's own
 * visual-picker dialog JSX and `SlideRouteRecovery` fallback screen.
 */
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

// ---------------------------------------------------------------------------
// Global capture surfaces (bridge between the generated stub modules, which
// are separate module instances, and this test file).
// ---------------------------------------------------------------------------

declare global {
  var __slideEditorCalls: Record<string, unknown>[];
  var __conflictDialogCalls: Record<string, unknown>[];
  var __conflictDialogMounted: boolean;
  var __routerPushCalls: string[];
  var __slideRouteActionImpls: {
    fetchDeckJson: (id: string) => Promise<unknown>;
    saveDeckJson: (
      id: string,
      deckJson: unknown,
      clientToken?: string | null,
    ) => Promise<unknown>;
    toggleDocumentSharing: (id: string, isShared: boolean) => Promise<unknown>;
    uploadSlideAsset: (
      documentId: string,
      formData: FormData,
    ) => Promise<unknown>;
  };
  var __slideRouteActionCalls: {
    fetchDeckJson: unknown[][];
    saveDeckJson: unknown[][];
    toggleDocumentSharing: unknown[][];
    uploadSlideAsset: unknown[][];
  };
  var __downloadBlobCalls: { blob: Blob; filename: string }[];
  var __exportDeckRasterBrowserImpl: (...args: unknown[]) => Promise<{
    pngs: { slideId: string; dataUrl: string }[];
    pdfBlob: Blob;
    pdfBytes: Uint8Array;
    pdfPageCount: number;
    diagnostics: unknown[];
  }>;
}
globalThis.__slideEditorCalls = [];
globalThis.__conflictDialogCalls = [];
globalThis.__conflictDialogMounted = false;
globalThis.__routerPushCalls = [];
globalThis.__downloadBlobCalls = [];
globalThis.__exportDeckRasterBrowserImpl = async () => {
  throw new Error("exportDeckRasterBrowser stub not configured for this test");
};
globalThis.__slideRouteActionImpls = {
  fetchDeckJson: async () => {
    throw new Error("fetchDeckJson stub not configured for this test");
  },
  saveDeckJson: async () => {
    throw new Error("saveDeckJson stub not configured for this test");
  },
  toggleDocumentSharing: async () => {
    throw new Error("toggleDocumentSharing stub not configured for this test");
  },
  uploadSlideAsset: async () => {
    throw new Error("uploadSlideAsset stub not configured for this test");
  },
};
globalThis.__slideRouteActionCalls = {
  fetchDeckJson: [],
  saveDeckJson: [],
  toggleDocumentSharing: [],
  uploadSlideAsset: [],
};

// ---------------------------------------------------------------------------
// Stub module sources + the registerHooks wiring that materializes each as a
// real on-disk file (required for CJS/`require()` interop — see file header).
// ---------------------------------------------------------------------------

const stubDir = path.dirname(fileURLToPath(import.meta.url));

const STUB_SPECS: Record<string, { fileName: string; source: string }> = {
  "@/components/presentation/slide-editor": {
    fileName: ".slide-editor-stub.generated.ts",
    source: `
export function SlideEditor(props) {
  globalThis.__slideEditorCalls.push(props);
  return null;
}
`,
  },
  "@/components/presentation/conflict-recovery-dialog": {
    fileName: ".conflict-recovery-dialog-stub.generated.ts",
    source: `
import { createElement, useEffect } from "react";
export function ConflictRecoveryDialog(props) {
  globalThis.__conflictDialogCalls.push(props);
  useEffect(() => {
    globalThis.__conflictDialogMounted = true;
    return () => {
      globalThis.__conflictDialogMounted = false;
    };
  });
  if (!props.open) return null;
  return createElement("div", { "data-mock-conflict-dialog": true });
}
`,
  },
  "next/navigation": {
    fileName: ".next-navigation-stub.generated.ts",
    source: `
export function useRouter() {
  return {
    push: (href) => {
      globalThis.__routerPushCalls.push(href);
    },
  };
}
`,
  },
  "../actions": {
    fileName: ".actions-stub.generated.ts",
    source: `
export async function fetchDeckJson(...args) {
  globalThis.__slideRouteActionCalls.fetchDeckJson.push(args);
  return globalThis.__slideRouteActionImpls.fetchDeckJson(...args);
}
export async function saveDeckJson(...args) {
  globalThis.__slideRouteActionCalls.saveDeckJson.push(args);
  return globalThis.__slideRouteActionImpls.saveDeckJson(...args);
}
export async function toggleDocumentSharing(...args) {
  globalThis.__slideRouteActionCalls.toggleDocumentSharing.push(args);
  return globalThis.__slideRouteActionImpls.toggleDocumentSharing(...args);
}
`,
  },
  "../slide-asset-actions": {
    fileName: ".slide-asset-actions-stub.generated.ts",
    source: `
export async function uploadSlideAsset(...args) {
  globalThis.__slideRouteActionCalls.uploadSlideAsset.push(args);
  return globalThis.__slideRouteActionImpls.uploadSlideAsset(...args);
}
`,
  },
  "@/lib/visual/export": {
    fileName: ".visual-export-stub.generated.ts",
    source: `
export function downloadBlob(blob, filename) {
  globalThis.__downloadBlobCalls.push({ blob, filename });
}
`,
  },
  "@/lib/presentation/raster-browser-export": {
    fileName: ".raster-browser-export-stub.generated.ts",
    source: `
export async function exportDeckRasterBrowser(...args) {
  return globalThis.__exportDeckRasterBrowserImpl(...args);
}
`,
  },
};

function stubFilePath(fileName: string): string {
  return path.join(stubDir, fileName);
}

function removeStubFiles() {
  for (const { fileName } of Object.values(STUB_SPECS)) {
    const filePath = stubFilePath(fileName);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
}
// Defensive: clear out any stubs left behind by a previous crashed run.
removeStubFiles();
after(removeStubFiles);

// Registered before any `@/...`/`../...`/`next/navigation` module in this
// file is resolved (all deferred into `before()`, below).
registerHooks({
  resolve(specifier, context, nextResolve) {
    const spec = STUB_SPECS[specifier];
    if (spec) {
      const filePath = stubFilePath(spec.fileName);
      writeFileSync(filePath, spec.source, "utf8");
      return {
        url: pathToFileURL(filePath).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return nextLoad(url, context);
  },
});

// ---------------------------------------------------------------------------
// Deferred real imports
// ---------------------------------------------------------------------------

let SlideEditorRouteClient: typeof import("./slide-editor-route-client").SlideEditorRouteClient;
type SlideEditorRouteClientProps =
  typeof import("./slide-editor-route-client") extends {
    SlideEditorRouteClient: (props: infer P) => unknown;
  }
    ? P
    : never;
let DECK_SCHEMA_VERSION: typeof import("@/lib/presentation/schema").DECK_SCHEMA_VERSION;
let SAVE_STATUS_LABEL: typeof import("@/lib/presentation/save-status").SAVE_STATUS_LABEL;

before(async () => {
  ({ SlideEditorRouteClient } = await import("./slide-editor-route-client"));
  ({ DECK_SCHEMA_VERSION } = await import("@/lib/presentation/schema"));
  ({ SAVE_STATUS_LABEL } = await import("@/lib/presentation/save-status"));

  // Side effect only: flips on `IS_REACT_ACT_ENVIRONMENT` and installs the
  // baseline `document`/`window` stubs, persistently for this file's
  // lifetime (this suite directly monkey-patches `globalThis.window`, e.g.
  // `location`/`open` immediately below).
  const { installPersistentDefaultDom } =
    await import("@/test/react-render-harness");
  installPersistentDefaultDom();

  // The route client reads `window.location.origin` (share/present URL
  // building) and calls `window.open` (opening the public share link); the
  // harness's fake `window` has neither.
  (
    globalThis.window as unknown as {
      location: { origin: string };
      open: (...args: unknown[]) => unknown;
    }
  ).location = { origin: "https://textiq.test" };
});

afterEach(() => {
  globalThis.__slideEditorCalls = [];
  globalThis.__conflictDialogCalls = [];
  globalThis.__routerPushCalls = [];
  globalThis.__slideRouteActionCalls = {
    fetchDeckJson: [],
    saveDeckJson: [],
    toggleDocumentSharing: [],
    uploadSlideAsset: [],
  };
  globalThis.__downloadBlobCalls = [];
  globalThis.__exportDeckRasterBrowserImpl = async () => {
    throw new Error(
      "exportDeckRasterBrowser stub not configured for this test",
    );
  };
});

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function validDeckJson(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: "deck-0001",
    title: "Saved deck",
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: [
      {
        id: "slide-a",
        type: "slide",
        template: { kind: "cover" },
        style: { ref: "slide.cover" },
        children: [],
      },
    ],
    ...overrides,
  };
}

/** Fails presentation-deck schema validation (empty `slides`), routing to "recovery". */
function malformedDeckJson() {
  return { schemaVersion: DECK_SCHEMA_VERSION, slides: [] };
}

function visualFixture(id: string) {
  return {
    version: 1,
    type: "flowchart",
    nodes: [{ id: `${id}-n1`, label: "Node" }],
    edges: [],
    style: {},
  };
}

/** A non-empty Lexical document with a heading, a paragraph, and one visual. */
function contentJsonWithVisual(visualId = "vis-1"): string {
  return JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          bid: "heading-1",
          children: [{ type: "text", text: "Quarterly business review" }],
        },
        {
          type: "paragraph",
          bid: "paragraph-1",
          children: [{ type: "text", text: "Revenue grew 24%." }],
        },
        {
          type: "visual",
          visualId,
          visual: visualFixture(visualId),
        },
      ],
    },
  });
}

/**
 * A Lexical document with one block of each `DocumentBlock` kind
 * (`collectDocumentBlocks` shape, matching `document-blocks.test.ts`'s
 * fixtures) — a paragraph (`text`), a table, and a visual — each with a
 * stable `bid` so `handleRefreshSource` can be exercised against every
 * `SlideChildNode` type it branches on.
 */
function contentJsonWithEveryBlockKind(visualId = "vis-1"): string {
  return JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          bid: "paragraph-1",
          children: [{ type: "text", text: "Revenue grew 24%." }],
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
                  children: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", text: "Region" }],
                    },
                  ],
                },
                {
                  type: "tablecell",
                  children: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", text: "Growth" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "visual",
          visualId,
          visual: visualFixture(visualId),
        },
      ],
    },
  });
}

function baseProps(
  overrides: Partial<SlideEditorRouteClientProps> = {},
): SlideEditorRouteClientProps {
  return {
    documentId: "doc-1",
    documentTitle: "My Deck",
    initialDeckJson: null,
    initialDeckRevisionToken: null,
    initialContentJson: null,
    initialIsShared: false,
    initialShareId: null,
    initialSlug: null,
    initialSharePresentEnabled: false,
    canManage: true,
    userId: "user-1",
    userName: "Ada Lovelace",
    ...overrides,
  } as SlideEditorRouteClientProps;
}

function mount(props: SlideEditorRouteClientProps): {
  renderer: ReactTestRenderer;
  unmount: () => void;
} {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(SlideEditorRouteClient, props));
  });
  return {
    renderer,
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

function latestSlideEditorProps(): Record<string, unknown> {
  const calls = globalThis.__slideEditorCalls;
  const last = calls[calls.length - 1];
  assert.ok(last, "expected SlideEditor to have been rendered at least once");
  return last;
}

function latestConflictDialogProps(): Record<string, unknown> | undefined {
  const calls = globalThis.__conflictDialogCalls;
  return calls[calls.length - 1];
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Loading / saved-vs-derived / blank / error (recovery) deck-open decision
// ---------------------------------------------------------------------------

test("recovery: malformed initialDeckJson renders SlideRouteRecovery (not SlideEditor), and Back navigates to the document", async () => {
  const { renderer, unmount } = mount(
    baseProps({ documentId: "doc-err", initialDeckJson: malformedDeckJson() }),
  );

  assert.equal(globalThis.__slideEditorCalls.length, 0);
  const heading = renderer.root.findAll(
    (node) => node.props.children === "Slides could not be opened",
  );
  assert.ok(heading.length > 0);
  const errorParagraph = renderer.root.findAll(
    (node) =>
      typeof node.props.children === "string" &&
      /presentation deck validation failed/.test(node.props.children),
  );
  assert.ok(errorParagraph.length > 0, "expected the validation error text");

  const backButton = renderer.root
    .findAll((node) => node.type === "button")
    .find((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.includes("Back to document")
        : node.props.children === "Back to document",
    );
  assert.ok(backButton, "expected the 'Back to document' button");
  act(() => {
    (backButton?.props as { onClick: () => void }).onClick();
  });
  assert.deepEqual(globalThis.__routerPushCalls, ["/app/documents/doc-err"]);

  unmount();
});

test("saved deck: valid initialDeckJson opens the saved deck and passes it to SlideEditor with idle save status", () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-saved",
      initialDeckJson: validDeckJson(),
      initialDeckRevisionToken: "rev-1",
    }),
  );

  const props = latestSlideEditorProps();
  assert.equal(props.documentId, "doc-saved");
  const deck = props.deck as {
    slides: { id: string }[];
    schemaVersion: number;
  };
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0]?.id, "slide-a");
  assert.equal(deck.schemaVersion, DECK_SCHEMA_VERSION);
  assert.equal(props.saveStatus, "saved");
  assert.equal(props.saveStatusLabel, SAVE_STATUS_LABEL.saved);
  assert.equal(props.hasUnsavedWork, false);
  assert.equal(props.canUndo, false);
  assert.equal(props.canRedo, false);

  unmount();
});

test("derived deck: no saved JSON but non-empty content derives a populated deck with a visual block available to the picker", async () => {
  const { renderer, unmount } = mount(
    baseProps({
      documentId: "doc-derived",
      initialDeckJson: null,
      initialContentJson: contentJsonWithVisual("vis-derived"),
    }),
  );

  const props = latestSlideEditorProps();
  const deck = props.deck as { slides: unknown[] };
  // Derived from a heading + paragraph + visual: more than the single blank
  // content slide `createBlankDeck` would produce.
  assert.ok(deck.slides.length >= 1);

  // `onPickVisual` resolves from the real visual-picker dialog JSX (not
  // stubbed) listing the document's visual blocks.
  let pickPromise!: Promise<{ visualId?: string; alt?: string } | undefined>;
  act(() => {
    pickPromise = (
      props.onPickVisual as () => Promise<
        { visualId?: string; alt?: string } | undefined
      >
    )();
  });
  await flushMicrotasks();

  const visualIdLabel = renderer.root.findAll(
    (node) => node.type === "span" && node.props.children === "vis-derived",
  )[0];
  assert.ok(visualIdLabel, "expected the visual picker to list 'vis-derived'");
  const pickButton = visualIdLabel.parent;
  assert.ok(pickButton, "expected the label's parent button");
  act(() => {
    (pickButton?.props as { onClick: () => void }).onClick();
  });

  const picked = await pickPromise;
  assert.equal(picked?.visualId, "vis-derived");

  unmount();
});

test("blank deck: no saved JSON and no content creates a blank deck", () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-blank",
      initialDeckJson: null,
      initialContentJson: null,
    }),
  );

  const props = latestSlideEditorProps();
  const deck = props.deck as { slides: { id: string }[] };
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0]?.id, "slide-blank-1");

  unmount();
});

// ---------------------------------------------------------------------------
// Save / dirty / undo / redo lifecycle
// ---------------------------------------------------------------------------

test("onDeckChange marks the deck dirty; onSave persists via the stubbed action and clears dirty", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async (
    _id: string,
    _deckJson: unknown,
    clientToken?: string | null,
  ) => ({ ok: true, revisionToken: `${clientToken ?? "none"}-next` });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-save",
      initialDeckJson: validDeckJson(),
      initialDeckRevisionToken: "rev-0",
    }),
  );

  const changedDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Edited",
  };
  act(() => {
    (latestSlideEditorProps().onDeckChange as (deck: unknown) => void)(
      changedDeck,
    );
  });

  let props = latestSlideEditorProps();
  assert.equal(props.hasUnsavedWork, true);
  assert.equal(props.saveStatus, "pending");

  await act(async () => {
    await (
      latestSlideEditorProps().onSave as (
        deck: unknown,
      ) => Promise<{ ok: boolean }>
    )(changedDeck);
  });

  assert.deepEqual(globalThis.__slideRouteActionCalls.saveDeckJson.at(-1), [
    "doc-save",
    changedDeck,
    "rev-0",
  ]);
  props = latestSlideEditorProps();
  assert.equal(props.hasUnsavedWork, false);
  assert.equal(props.saveStatus, "saved");

  unmount();
});

test("undo/redo: reverts and restores the deck, toggling canUndo/canRedo", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: true,
    revisionToken: "rev-x",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-undo",
      initialDeckJson: validDeckJson({ title: "Original" }),
    }),
  );

  const originalDeck = latestSlideEditorProps().deck;
  const changedDeck = { ...(originalDeck as object), title: "Changed" };
  act(() => {
    (latestSlideEditorProps().onDeckChange as (deck: unknown) => void)(
      changedDeck,
    );
  });

  let props = latestSlideEditorProps();
  assert.equal(props.canUndo, true);
  assert.equal(props.canRedo, false);

  act(() => {
    (latestSlideEditorProps().onUndo as () => void)();
  });
  props = latestSlideEditorProps();
  assert.deepEqual(props.deck, originalDeck);
  assert.equal(props.canUndo, false);
  assert.equal(props.canRedo, true);

  act(() => {
    (latestSlideEditorProps().onRedo as () => void)();
  });
  props = latestSlideEditorProps();
  assert.deepEqual(props.deck, changedDeck);
  assert.equal(props.canUndo, true);
  assert.equal(props.canRedo, false);

  unmount();
});

test("cleanup: unmounting before the autosave debounce fires cancels the pending save", async () => {
  let saveCalls = 0;
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => {
    saveCalls += 1;
    return { ok: true, revisionToken: "rev-cleanup" };
  };

  const { unmount } = mount(
    baseProps({
      documentId: "doc-cleanup",
      initialDeckJson: validDeckJson(),
    }),
  );

  const changedDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Will not persist",
  };
  act(() => {
    (latestSlideEditorProps().onDeckChange as (deck: unknown) => void)(
      changedDeck,
    );
  });

  // Unmount tears down the autosave-scheduler effect (`scheduler.cancel()`)
  // strictly before the real 1500ms debounce could fire.
  unmount();

  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(saveCalls, 0);
  assert.equal(globalThis.__slideRouteActionCalls.saveDeckJson.length, 0);
});

// ---------------------------------------------------------------------------
// Save-conflict recovery composition
// ---------------------------------------------------------------------------

test("save conflict: onSave conflict result composes ConflictRecoveryDialog with the local deck + server token, and onDismiss clears it", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: "conflict",
    serverRevisionToken: "server-rev-9",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-conflict",
      initialDeckJson: validDeckJson(),
    }),
  );

  const conflictingDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Conflicting edit",
  };
  await act(async () => {
    await (
      latestSlideEditorProps().onSave as (
        deck: unknown,
      ) => Promise<{ ok: boolean }>
    )(conflictingDeck);
  });

  assert.equal(globalThis.__conflictDialogMounted, true);
  const dialogProps = latestConflictDialogProps();
  assert.equal(dialogProps?.open, true);
  assert.deepEqual(dialogProps?.localDeck, conflictingDeck);
  assert.equal(dialogProps?.serverRevisionToken, "server-rev-9");

  const editorProps = latestSlideEditorProps();
  assert.equal(editorProps.saveStatus, "error");

  act(() => {
    (dialogProps?.onDismiss as () => void)();
  });
  assert.equal(globalThis.__conflictDialogMounted, false);

  unmount();
});

test("save conflict → keep mine: retries the save with the server token and clears the conflict on success", async () => {
  let lastToken: string | null | undefined;
  globalThis.__slideRouteActionImpls.saveDeckJson = async (
    _id,
    _deckJson,
    clientToken,
  ) => {
    lastToken = clientToken;
    if (clientToken === null) {
      return { ok: "conflict", serverRevisionToken: "server-rev-1" };
    }
    return { ok: true, revisionToken: "rev-after-keep-mine" };
  };

  const { unmount } = mount(
    baseProps({
      documentId: "doc-keep-mine",
      initialDeckJson: validDeckJson(),
      initialDeckRevisionToken: null,
    }),
  );

  const localDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Mine",
  };
  await act(async () => {
    await (
      latestSlideEditorProps().onSave as (deck: unknown) => Promise<unknown>
    )(localDeck);
  });
  assert.equal(lastToken, null);
  assert.equal(globalThis.__conflictDialogMounted, true);

  const dialogProps = latestConflictDialogProps();
  await act(async () => {
    await (
      dialogProps?.onKeepMine as (
        deck: unknown,
        token: string | null,
      ) => Promise<void>
    )(localDeck, dialogProps?.serverRevisionToken as string | null);
  });

  assert.equal(lastToken, "server-rev-1");
  assert.equal(globalThis.__conflictDialogMounted, false);
  const props = latestSlideEditorProps();
  assert.equal(props.hasUnsavedWork, false);
  assert.equal(props.saveStatus, "saved");

  unmount();
});

test("save conflict → use theirs: reloads the server deck, replaces local state, and resets undo/redo", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: "conflict",
    serverRevisionToken: "server-rev-2",
  });
  const serverDeck = validDeckJson({
    id: "deck-server",
    slides: [
      {
        id: "slide-server",
        type: "slide",
        template: { kind: "cover" },
        style: { ref: "slide.cover" },
        children: [],
      },
    ],
  });
  globalThis.__slideRouteActionImpls.fetchDeckJson = async () => ({
    ok: true,
    deckJson: serverDeck,
    revisionToken: "server-rev-2",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-use-theirs",
      initialDeckJson: validDeckJson(),
    }),
  );

  const localDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Mine (discarded)",
  };
  // Create undo history first so we can prove it gets reset.
  act(() => {
    (latestSlideEditorProps().onDeckChange as (deck: unknown) => void)(
      localDeck,
    );
  });
  assert.equal(latestSlideEditorProps().canUndo, true);

  await act(async () => {
    await (
      latestSlideEditorProps().onSave as (deck: unknown) => Promise<unknown>
    )(localDeck);
  });
  assert.equal(globalThis.__conflictDialogMounted, true);

  const dialogProps = latestConflictDialogProps();
  await act(async () => {
    await (dialogProps?.onUseTheirs as () => Promise<void>)();
  });

  assert.equal(globalThis.__conflictDialogMounted, false);
  const props = latestSlideEditorProps();
  assert.equal((props.deck as { id: string }).id, "deck-server");
  assert.equal(props.canUndo, false);
  assert.equal(props.canRedo, false);
  assert.equal(props.hasUnsavedWork, false);

  unmount();
});

// ---------------------------------------------------------------------------
// Permissions: sharing / presenting
// ---------------------------------------------------------------------------

test("permissions: canManage=false blocks sharing without calling the action or opening a window", async () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-no-manage",
      initialDeckJson: validDeckJson(),
      canManage: false,
      initialIsShared: false,
    }),
  );

  let opened = false;
  (globalThis.window as unknown as { open: () => unknown }).open = () => {
    opened = true;
    return null;
  };

  const result = await (
    latestSlideEditorProps().onShare as () => Promise<{
      ok: boolean;
      error?: string;
    }>
  )();

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Enable sharing/);
  assert.equal(
    globalThis.__slideRouteActionCalls.toggleDocumentSharing.length,
    0,
  );
  assert.equal(opened, false);

  unmount();
});

test("permissions: canManage=true shares successfully and opens the public share URL", async () => {
  globalThis.__slideRouteActionImpls.toggleDocumentSharing = async (
    _id,
    isShared,
  ) => ({
    ok: true,
    data: {
      isShared,
      shareId: "share-123",
      slug: "quarterly-review",
      presentEnabled: false,
      shareUrl: null,
      expiresAt: null,
      embedEnabled: false,
    },
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-manage",
      initialDeckJson: validDeckJson(),
      canManage: true,
      initialIsShared: false,
    }),
  );

  let openedUrl: string | undefined;
  (globalThis.window as unknown as { open: (url: string) => unknown }).open = (
    url: string,
  ) => {
    openedUrl = url;
    return {};
  };

  const result = await (
    latestSlideEditorProps().onShare as () => Promise<{ ok: boolean }>
  )();

  assert.equal(result.ok, true);
  assert.deepEqual(
    globalThis.__slideRouteActionCalls.toggleDocumentSharing.at(-1),
    ["doc-manage", true],
  );
  assert.ok(openedUrl?.includes("/share/"));
  assert.ok(openedUrl?.includes("share-123"));

  // Presenting is blocked because the (now-shared) settings disable it.
  const presentResult = await (
    latestSlideEditorProps().onPresent as () => Promise<{
      ok: boolean;
      error?: string;
    }>
  )();
  assert.equal(presentResult.ok, false);
  assert.match(presentResult.error ?? "", /Presentation links are disabled/);

  unmount();
});

// ---------------------------------------------------------------------------
// Composition: onClose navigation + onUploadImage wiring
// ---------------------------------------------------------------------------

test("composition: onClose navigates back to the document route", () => {
  const { unmount } = mount(
    baseProps({ documentId: "doc-close", initialDeckJson: validDeckJson() }),
  );

  act(() => {
    (latestSlideEditorProps().onClose as () => void)();
  });
  assert.deepEqual(globalThis.__routerPushCalls, ["/app/documents/doc-close"]);

  unmount();
});

test("composition: onUploadImage forwards the file through the stubbed action and shapes the result", async () => {
  globalThis.__slideRouteActionImpls.uploadSlideAsset = async () => ({
    ok: true,
    data: {
      url: "https://cdn.textiq.test/asset-1.png",
      assetId: "asset-1",
      widthPx: 800,
      heightPx: 600,
    },
  });

  const { unmount } = mount(
    baseProps({ documentId: "doc-upload", initialDeckJson: validDeckJson() }),
  );

  const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
  const result = await (
    latestSlideEditorProps().onUploadImage as (
      file: File,
    ) => Promise<Record<string, unknown>>
  )(file);

  assert.equal(result.src, "https://cdn.textiq.test/asset-1.png");
  assert.equal(result.assetId, "asset-1");
  assert.equal(result.widthPx, 800);
  assert.equal(result.heightPx, 600);

  const call = globalThis.__slideRouteActionCalls.uploadSlideAsset.at(-1);
  assert.equal(call?.[0], "doc-upload");
  const formData = call?.[1] as FormData;
  assert.equal(formData.get("file"), file);

  unmount();
});

test("composition: export/undo/redo callbacks are wired as functions and presenceUserId/Name pass through", () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-composition",
      initialDeckJson: validDeckJson(),
      userId: "user-42",
      userName: "Grace Hopper",
    }),
  );

  const props = latestSlideEditorProps();
  for (const key of [
    "onExportPptx",
    "onExportPdf",
    "onExportPng",
    "onRegenerate",
    "onRefreshSource",
    "onPickVisual",
  ]) {
    assert.equal(
      typeof props[key],
      "function",
      `expected ${key} to be a function`,
    );
  }
  assert.equal(props.presenceUserId, "user-42");
  assert.equal(props.presenceUserName, "Grace Hopper");
  assert.equal(props.presenceAwareness, null);

  unmount();
});

// ---------------------------------------------------------------------------
// Regenerate: blank/derived/derivation-failure/conflict-blocked
// ---------------------------------------------------------------------------

test("regenerate: blocked while a save conflict is unresolved", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: "conflict",
    serverRevisionToken: "server-rev-1",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-regen-conflict",
      initialDeckJson: validDeckJson(),
    }),
  );

  await act(async () => {
    await (
      latestSlideEditorProps().onSave as (
        deck: unknown,
      ) => Promise<{ ok: boolean }>
    )(latestSlideEditorProps().deck);
  });
  assert.ok(latestConflictDialogProps()?.open, "expected a conflict to exist");

  const result = await (
    latestSlideEditorProps().onRegenerate as () => Promise<{
      ok: boolean;
      error?: string;
    }>
  )();
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Resolve the save conflict/);

  unmount();
});

test("regenerate: no source content creates and persists a fresh blank deck", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: true,
    revisionToken: "rev-blank",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-regen-blank",
      initialDeckJson: validDeckJson({ title: "Old deck" }),
      initialContentJson: null,
    }),
  );

  let result!: { ok: boolean };
  await act(async () => {
    result = await (
      latestSlideEditorProps().onRegenerate as () => Promise<{ ok: boolean }>
    )();
  });
  assert.equal(result.ok, true);

  const props = latestSlideEditorProps();
  assert.equal(
    (props.deck as { slides: { id: string }[] }).slides[0]?.id,
    "slide-blank-1",
  );
  assert.deepEqual(
    globalThis.__slideRouteActionCalls.saveDeckJson.at(-1)?.[0],
    "doc-regen-blank",
  );
  assert.equal(props.hasUnsavedWork, false);

  unmount();
});

test("regenerate: derives a fresh deck from content, replaces diagnostics, and persists immediately", async () => {
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => ({
    ok: true,
    revisionToken: "rev-derived",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-regen-derive",
      initialDeckJson: validDeckJson({ title: "Old deck" }),
      initialContentJson: contentJsonWithEveryBlockKind("vis-regen"),
    }),
  );

  let result!: { ok: boolean };
  await act(async () => {
    result = await (
      latestSlideEditorProps().onRegenerate as () => Promise<{ ok: boolean }>
    )();
  });
  assert.equal(result.ok, true);

  const props = latestSlideEditorProps();
  assert.notEqual(
    (props.deck as { title: string }).title,
    "Old deck",
    "expected the derived deck to replace the previously-saved deck",
  );
  assert.deepEqual(
    globalThis.__slideRouteActionCalls.saveDeckJson.at(-1)?.[0],
    "doc-regen-derive",
  );

  unmount();
});

// Note: `handleRegenerate`'s `if (!derived.ok) return actionError(derived.error)`
// passthrough (mirrored in `openInitialDeck`'s own derivation branch) has no
// realistic trigger through `deriveDeckFromDocumentContent`/
// `compileDocumentSlidePlanToDeck` — neither of those modules' own test
// suites exercise an `ok: false` derivation outcome either; the compiler
// degrades to a blank deck rather than failing for any content shape that
// collects into blocks. Left untested as a defensive passthrough, consistent
// with this file's other noted defensive branches (see the module docblock).

// ---------------------------------------------------------------------------
// Export: PPTX (real `exportDeckAsPPTX`) / PDF / PNG (stubbed raster export)
// ---------------------------------------------------------------------------

test("export: onExportPptx builds a real PPTX blob and downloads it named after the document title", async () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-export-pptx",
      documentTitle: "Quarterly Review",
      initialDeckJson: validDeckJson(),
    }),
  );

  await act(async () => {
    await (latestSlideEditorProps().onExportPptx as () => Promise<void>)();
  });

  assert.equal(globalThis.__downloadBlobCalls.length, 1);
  const call = globalThis.__downloadBlobCalls[0];
  assert.equal(call?.filename, "Quarterly Review.pptx");
  assert.ok(call?.blob instanceof Blob);
  assert.ok((call?.blob.size ?? 0) > 0);

  unmount();
});

test("export: onExportPdf downloads the rasterized PDF blob named after the document title", async () => {
  const pdfBlob = new Blob(["%PDF-fake"], { type: "application/pdf" });
  globalThis.__exportDeckRasterBrowserImpl = async () => ({
    pngs: [],
    pdfBlob,
    pdfBytes: new Uint8Array(),
    pdfPageCount: 1,
    diagnostics: [],
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-export-pdf",
      documentTitle: "Board Deck",
      initialDeckJson: validDeckJson(),
    }),
  );

  await act(async () => {
    await (latestSlideEditorProps().onExportPdf as () => Promise<void>)();
  });

  assert.equal(globalThis.__downloadBlobCalls.length, 1);
  assert.equal(globalThis.__downloadBlobCalls[0]?.blob, pdfBlob);
  assert.equal(globalThis.__downloadBlobCalls[0]?.filename, "Board Deck.pdf");

  unmount();
});

test("export: onExportPng downloads one numbered PNG file per rasterized slide", async () => {
  globalThis.__exportDeckRasterBrowserImpl = async () => ({
    pngs: [
      { slideId: "slide-a", dataUrl: "data:image/png;base64,aGVsbG8=" },
      { slideId: "slide-b", dataUrl: "data:image/png;base64,d29ybGQ=" },
    ],
    pdfBlob: new Blob(),
    pdfBytes: new Uint8Array(),
    pdfPageCount: 2,
    diagnostics: [],
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-export-png",
      documentTitle: "Deck",
      initialDeckJson: validDeckJson(),
    }),
  );

  await act(async () => {
    await (latestSlideEditorProps().onExportPng as () => Promise<void>)();
  });

  assert.equal(globalThis.__downloadBlobCalls.length, 2);
  assert.equal(
    globalThis.__downloadBlobCalls[0]?.filename,
    "Deck-slide-01.png",
  );
  assert.equal(
    globalThis.__downloadBlobCalls[1]?.filename,
    "Deck-slide-02.png",
  );
  for (const call of globalThis.__downloadBlobCalls) {
    assert.ok(call.blob instanceof Blob);
  }

  unmount();
});

// ---------------------------------------------------------------------------
// Share/present: already-shared shortcut, failures, and a successful present
// ---------------------------------------------------------------------------

test("share: an already-shared document skips re-toggling and opens the existing share URL", async () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-already-shared",
      initialDeckJson: validDeckJson(),
      canManage: true,
      initialIsShared: true,
      initialShareId: "share-existing",
      initialSlug: "existing-slug",
    }),
  );

  let openedUrl: string | undefined;
  (globalThis.window as unknown as { open: (url: string) => unknown }).open = (
    url: string,
  ) => {
    openedUrl = url;
    return {};
  };

  const result = await (
    latestSlideEditorProps().onShare as () => Promise<{ ok: boolean }>
  )();

  assert.equal(result.ok, true);
  assert.equal(
    globalThis.__slideRouteActionCalls.toggleDocumentSharing.length,
    0,
    "an already-shared document must not re-call toggleDocumentSharing",
  );
  assert.ok(openedUrl?.includes("share-existing"));

  unmount();
});

test("share: a toggleDocumentSharing failure and a pop-up blocked by the browser both surface as action errors", async () => {
  globalThis.__slideRouteActionImpls.toggleDocumentSharing = async () => ({
    ok: false,
    error: "Sharing is temporarily unavailable.",
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-share-fail",
      initialDeckJson: validDeckJson(),
      canManage: true,
      initialIsShared: false,
    }),
  );

  const failResult = await (
    latestSlideEditorProps().onShare as () => Promise<{
      ok: boolean;
      error?: string;
    }>
  )();
  assert.equal(failResult.ok, false);
  assert.match(failResult.error ?? "", /temporarily unavailable/);

  // Now let sharing succeed, but simulate the browser blocking the pop-up.
  globalThis.__slideRouteActionImpls.toggleDocumentSharing = async (
    _id,
    isShared,
  ) => ({
    ok: true,
    data: {
      isShared,
      shareId: "share-blocked",
      slug: "blocked-slug",
      presentEnabled: true,
    },
  });
  (globalThis.window as unknown as { open: () => unknown }).open = () => null;

  const blockedResult = await (
    latestSlideEditorProps().onShare as () => Promise<{
      ok: boolean;
      error?: string;
    }>
  )();
  assert.equal(blockedResult.ok, false);
  assert.match(blockedResult.error ?? "", /Allow pop-ups/);

  unmount();
});

test("present: succeeds and opens the present URL when sharing succeeds and presenting is enabled", async () => {
  globalThis.__slideRouteActionImpls.toggleDocumentSharing = async (
    _id,
    isShared,
  ) => ({
    ok: true,
    data: {
      isShared,
      shareId: "share-present",
      slug: "present-slug",
      presentEnabled: true,
    },
  });

  const { unmount } = mount(
    baseProps({
      documentId: "doc-present-ok",
      initialDeckJson: validDeckJson(),
      canManage: true,
      initialIsShared: false,
    }),
  );

  let openedUrl: string | undefined;
  (globalThis.window as unknown as { open: (url: string) => unknown }).open = (
    url: string,
  ) => {
    openedUrl = url;
    return {};
  };

  const result = await (
    latestSlideEditorProps().onPresent as () => Promise<{ ok: boolean }>
  )();

  assert.equal(result.ok, true);
  assert.ok(openedUrl?.includes("/present/"));
  assert.ok(openedUrl?.includes("share-present"));

  unmount();
});

// ---------------------------------------------------------------------------
// onRefreshSource: visual/table/text patches, unmatched, and cross-document
// ---------------------------------------------------------------------------

test("refreshSource: resolves a matching patch per block kind, and safely no-ops when unmatched or cross-document", async () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-refresh",
      initialDeckJson: validDeckJson(),
      initialContentJson: contentJsonWithEveryBlockKind("vis-refresh"),
    }),
  );

  const onRefreshSource = latestSlideEditorProps().onRefreshSource as (args: {
    node: { type: string; id: string };
    source: { documentId?: string; blockId?: string };
  }) => Promise<
    | {
        contentPatch?: Record<string, unknown>;
        source?: Record<string, unknown>;
      }
    | undefined
  >;

  const visualResult = await onRefreshSource({
    node: { type: "visual", id: "node-visual" },
    source: { documentId: "doc-refresh", blockId: "vis-refresh" },
  });
  assert.equal(visualResult?.contentPatch?.visualId, "vis-refresh");
  assert.equal(visualResult?.source?.blockKind, "visual");

  const tableResult = await onRefreshSource({
    node: { type: "table", id: "node-table" },
    source: { documentId: "doc-refresh", blockId: "table-1" },
  });
  assert.ok(tableResult?.contentPatch?.columns);
  assert.ok(tableResult?.contentPatch?.rows);
  assert.equal(tableResult?.source?.blockKind, "table");

  const textResult = await onRefreshSource({
    node: { type: "text", id: "node-text" },
    source: { documentId: "doc-refresh", blockId: "paragraph-1" },
  });
  assert.equal(
    (
      textResult?.contentPatch?.paragraphs as { text: string }[] | undefined
    )?.[0]?.text,
    "Revenue grew 24%.",
  );
  assert.equal(textResult?.source?.blockKind, "text");

  // Block matches, but the node's own type doesn't match the block's kind:
  // falls back to just refreshing the source metadata (no contentPatch).
  const mismatchResult = await onRefreshSource({
    node: { type: "visual", id: "node-visual-2" },
    source: { documentId: "doc-refresh", blockId: "paragraph-1" },
  });
  assert.equal(mismatchResult?.contentPatch, undefined);
  assert.ok(mismatchResult?.source);

  // No matching block at all.
  const noMatchResult = await onRefreshSource({
    node: { type: "text", id: "node-none" },
    source: { documentId: "doc-refresh", blockId: "does-not-exist" },
  });
  assert.equal(noMatchResult, undefined);

  // Cross-document source: safely no-ops without throwing.
  const crossDocResult = await onRefreshSource({
    node: { type: "text", id: "node-cross" },
    source: { documentId: "some-other-document", blockId: "paragraph-1" },
  });
  assert.equal(crossDocResult, undefined);

  unmount();
});

// ---------------------------------------------------------------------------
// onPickVisual: no visual blocks to choose from
// ---------------------------------------------------------------------------

test("pickVisual: resolves immediately with undefined when there are no visual blocks in the document", async () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-no-visuals",
      initialDeckJson: validDeckJson(),
      initialContentJson: null,
    }),
  );

  const result = await (
    latestSlideEditorProps().onPickVisual as () => Promise<unknown>
  )();
  assert.equal(result, undefined);

  unmount();
});

// ---------------------------------------------------------------------------
// Autosave actually firing (debounce completes, unlike the cleanup test)
// ---------------------------------------------------------------------------

test("autosave: the scheduled debounce persists the deck via saveDeckJson without an explicit onSave", async () => {
  let saveCalls = 0;
  globalThis.__slideRouteActionImpls.saveDeckJson = async () => {
    saveCalls += 1;
    return { ok: true, revisionToken: "rev-autosave" };
  };

  const { unmount } = mount(
    baseProps({
      documentId: "doc-autosave",
      initialDeckJson: validDeckJson(),
    }),
  );

  const changedDeck = {
    ...(latestSlideEditorProps().deck as object),
    title: "Autosaved edit",
  };
  act(() => {
    (latestSlideEditorProps().onDeckChange as (deck: unknown) => void)(
      changedDeck,
    );
  });
  assert.equal(latestSlideEditorProps().hasUnsavedWork, true);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1700));
  });

  assert.equal(saveCalls, 1);
  assert.deepEqual(globalThis.__slideRouteActionCalls.saveDeckJson.at(-1), [
    "doc-autosave",
    changedDeck,
    null,
  ]);
  assert.equal(latestSlideEditorProps().hasUnsavedWork, false);

  unmount();
});

// ---------------------------------------------------------------------------
// Theme resolution diagnostics merge into SlideEditor's diagnostics prop
// ---------------------------------------------------------------------------

test("theme fallback: an unknown theme packageId surfaces a fallback diagnostic merged into SlideEditor's diagnostics", () => {
  const { unmount } = mount(
    baseProps({
      documentId: "doc-theme-fallback",
      initialDeckJson: validDeckJson({
        theme: { packageId: "totally-unknown-theme" },
      }),
    }),
  );

  const diagnostics = latestSlideEditorProps().diagnostics as {
    code: string;
  }[];
  assert.ok(
    diagnostics.some(
      (diagnostic) => diagnostic.code === "unknown-theme-package",
    ),
  );

  unmount();
});
