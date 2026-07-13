/**
 * Direct behavior coverage for `MobileEditingSheetHost`/`MobileEditingSheet`
 * (#1959).
 *
 * `useEditingSurface()` (the real, already-exhaustively-tested bridge —
 * `use-editing-surface.test.ts` — over the pure `resolveEditingSurface`
 * decision) drives `{ mode, group }` from a genuine `@lexical/headless`
 * editor + `EditorContextProvider` + `VisualPanelProvider`, exactly as
 * `lexical-editor.tsx` composes them in production. The three sibling
 * sections this component switches between for the `"text-format"` and
 * `"visual-edit"` groups — `GenerateVisualSection`, `TextFormatSection`,
 * `VisualContextSection` — are each already covered end-to-end by their own
 * #1959 test files, so they are mounted for REAL here too (verifying only
 * that `renderSheetContent` composes the *correct* one per group, not
 * duplicating their internals).
 *
 * `@/components/ui`'s `BottomSheetSurface` is stubbed via a `node:module`
 * `registerHooks` resolve hook that generates a real, on-disk `.ts` file
 * re-exporting the *real* `@/components/ui` module verbatim
 * (`export * from "<real resolved path>"`) and overriding only the single
 * `BottomSheetSurface` binding — every other consumer (the real
 * `Button`/`IconButton`/`ColorPicker`/`Tooltip`/`Surface`/`cx`, including the
 * sibling sections mounted for real below) is completely unaffected. A
 * synthetic-URL scheme (`load()` returning inline source text) was tried
 * first but fails: this project's `.tsx` files are loaded through Node's
 * CommonJS `require()` under `tsx` (confirmed via stack traces — even
 * dynamic `import()` of a `.tsx` file ultimately calls `Module._load`), and
 * CJS's file read (`fs.readFileSync`) ignores a `registerHooks` `load()`
 * override entirely, throwing `ENOENT` on a non-filesystem URL. Writing a
 * real, temporary sibling file (cleaned up in `after()`) sidesteps that
 * limitation for both CJS and ESM callers. A `parentURL`-scoped stub was
 * also tried and separately fails: Node's synchronous `registerHooks`
 * resolver only invokes the hook once per unique specifier *text*
 * process-wide — the first resolution of `"@/components/ui"` (from
 * whichever file imports it first) is cached and reused for every other
 * importer without re-invoking the hook. Globally intercepting the
 * specifier and forwarding everything except `BottomSheetSurface`
 * sidesteps that too. Stubbing `BottomSheetSurface` itself was necessary
 * because mounting the real one (`createPortal` + `framer-motion`'s
 * `AnimatePresence`/`motion.div` + `useFocusTrap`) drives a genuine,
 * unbounded animation-frame loop that leaked past the test boundary in a
 * spike of this file — a concrete coupling that blocks a direct test
 * without a large, fragile jsdom-like DOM emulation layer this suite is
 * required to avoid. The stub is a trivial, synchronous
 * `open ? children : null` passthrough recording each call, so this file
 * still asserts the *real* `open`/`onClose`/`aria-label` wiring
 * `MobileEditingSheet` computes — just not `BottomSheetSurface`'s own
 * portal/motion internals (which have their own coverage in
 * `ui-interactions-coverage.test.ts`).
 *
 * The `"table-edit"` group (backed by the untested, 482-line
 * `table-controls.tsx`, not one of #1959's 7 target files) is intentionally
 * not exercised here — driving it would require mounting that sibling for
 * real, which is out of scope. Its `TableEditingSection` (imported at
 * module scope by `mobile-editing-sheet.tsx` regardless of which group
 * renders) and `./visual-context-popover`'s `VisualContextPopover`
 * (imported at module scope by the real `VisualContextSection`, mounted
 * below for the `"visual-edit"` group) are both stubbed with trivial
 * null-returning replacements via the same `registerHooks` mechanism, so
 * this file's tests don't transitively load those untested siblings (or
 * `./visual-context-popover`'s own `./icon-picker`/`./visual-context-
 * popover-panels` imports) into V8's coverage instrumentation purely as an
 * import-time side effect of composing the real, in-scope sections.
 */
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement, useEffect } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";

/**
 * `useActiveTableCaptionKey` (called on every render by `useEditingSurface`)
 * checks `document.activeElement instanceof HTMLElement`; a bare
 * `HTMLElement` reference throws a `ReferenceError` under Node unless a
 * global is installed, even though our fake `document.activeElement` would
 * resolve the check to `false`. Matches `use-editing-surface.test.ts`.
 */
const previousHTMLElement = Object.getOwnPropertyDescriptor(
  globalThis,
  "HTMLElement",
);
class FakeHTMLElement {}
Object.defineProperty(globalThis, "HTMLElement", {
  configurable: true,
  writable: true,
  value: FakeHTMLElement,
});
after(() => {
  if (previousHTMLElement) {
    Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
  } else {
    Reflect.deleteProperty(globalThis, "HTMLElement");
  }
});

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

declare global {
  var __mobileEditingSheetBottomSheetCalls: {
    open: boolean;
    ariaLabel: unknown;
  }[];
}
globalThis.__mobileEditingSheetBottomSheetCalls = [];

const stubFilePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".mobile-editing-sheet-ui-stub.generated.ts",
);
const stubbedSpecifier = "@/components/ui";

// `./table-controls` (the `"table-edit"` group's sibling, never mounted by
// this file's tests — see below) and `./visual-context-popover` (only
// reachable through the real `VisualContextSection` mounted for the
// `"visual-edit"` group, whose test deliberately resolves to a null-render
// `nodeKey` so the popover itself never renders) are both real, un-stubbed
// siblings with no test file of their own. Even though neither ever
// *renders* here, `mobile-editing-sheet.tsx`/`mobile-visual-context-
// section.tsx` still `import` them at module scope, so leaving them
// un-stubbed loads their real modules (and `./visual-context-popover`'s own
// `./icon-picker`/`./visual-context-popover-panels` imports) into V8's
// coverage instrumentation with only module-scope (not render-time)
// coverage — inflating the eligible-but-barely-covered surface this file's
// own composition tests should not be responsible for. A synthetic-URL
// `load()` stub (unlike `@/components/ui`'s on-disk-file workaround above)
// resolves cleanly for both: they're only ever reached via this file's own
// `await import("./mobile-editing-sheet")`/transitively `"./mobile-visual-
// context-section"` dynamic imports inside `before()`, which stay on the
// ESM loader path end to end.
const syntheticStubPrefix = "textiq-mobile-editing-sheet-stub:";
const syntheticStubSources: Record<string, string> = {
  "./table-controls": `
    export function TableEditingSection() {
      return null;
    }
    export function FloatingTableToolbar() {
      return null;
    }
  `,
  "./visual-context-popover": `
    export function VisualContextPopover() {
      return null;
    }
  `,
};

function buildStubSource(realAbsolutePath: string): string {
  return `import { createElement } from "react";
export * from ${JSON.stringify(realAbsolutePath)};

export function BottomSheetSurface({ open, onClose, children, "aria-label": ariaLabel }) {
  globalThis.__mobileEditingSheetBottomSheetCalls.push({ open, ariaLabel });
  if (!open) return null;
  return createElement(
    "div",
    {
      "data-mock-bottom-sheet": true,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": ariaLabel,
      onClose,
    },
    children,
  );
}
`;
}

function removeStubFile() {
  if (existsSync(stubFilePath)) {
    rmSync(stubFilePath);
  }
}
// Defensive: clear out any stub left behind by a previous crashed run before
// (re)generating it below.
removeStubFile();
after(removeStubFile);

// Registered before any `@/...`/`./...` module in this file is resolved (see
// below: those are all dynamically imported inside `before()`, deliberately
// *after* this call). Node's synchronous `registerHooks` resolver only
// invokes the hook once per unique specifier text process-wide — if any
// static import elsewhere in this file's graph resolved `"@/components/ui"`
// first (e.g. via a top-level `import` of a sibling section), that first
// resolution would be cached and reused for every later importer without
// ever re-invoking this hook, making the stub silently inert.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === stubbedSpecifier) {
      const real = nextResolve(specifier, context) as { url: string };
      const realPath = fileURLToPath(real.url);
      // Write a real, on-disk `.ts` file rather than returning a synthetic
      // URL resolved via `load()`'s inline `source`: this project's `.tsx`
      // files load through Node's CommonJS `require()` under `tsx` (even
      // when reached via dynamic `import()`), and CJS's own file read
      // (`fs.readFileSync`) ignores a `registerHooks` `load()` override
      // entirely, throwing `ENOENT` for a non-filesystem URL.
      writeFileSync(stubFilePath, buildStubSource(realPath), "utf8");
      return {
        url: pathToFileURL(stubFilePath).href,
        shortCircuit: true,
      };
    }
    if (Object.hasOwn(syntheticStubSources, specifier)) {
      return {
        url: `${syntheticStubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(syntheticStubPrefix)) {
      const specifier = decodeURIComponent(
        url.slice(syntheticStubPrefix.length),
      );
      return {
        format: "module",
        source: syntheticStubSources[specifier],
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

let VisualSvgRegistryProvider: typeof import("@/components/editor/visual-svg-registry").VisualSvgRegistryProvider;
let EditorContextProvider: typeof import("@/lib/lexical/editor-context").EditorContextProvider;
let VisualNode: typeof import("@/lib/lexical/visual-node").VisualNode;
let GenerateVisualSection: typeof import("./mobile-generate-visual-section").GenerateVisualSection;
let TextFormatSection: typeof import("./mobile-text-format-section").TextFormatSection;
let VisualContextSection: typeof import("./mobile-visual-context-section").VisualContextSection;
let useVisualPanel: typeof import("./visual-panel-context").useVisualPanel;
let VisualPanelProvider: typeof import("./visual-panel-context").VisualPanelProvider;
let MobileEditingSheetHost: typeof import("./mobile-editing-sheet").MobileEditingSheetHost;

before(async () => {
  ({ VisualSvgRegistryProvider } =
    await import("@/components/editor/visual-svg-registry"));
  ({ EditorContextProvider } = await import("@/lib/lexical/editor-context"));
  ({ VisualNode } = await import("@/lib/lexical/visual-node"));
  ({ GenerateVisualSection } =
    await import("./mobile-generate-visual-section"));
  ({ TextFormatSection } = await import("./mobile-text-format-section"));
  ({ VisualContextSection } = await import("./mobile-visual-context-section"));
  ({ useVisualPanel, VisualPanelProvider } =
    await import("./visual-panel-context"));
  ({ MobileEditingSheetHost } = await import("./mobile-editing-sheet"));

  // Side effect only: flips on `IS_REACT_ACT_ENVIRONMENT`; also installs the
  // baseline `document`/`window` stubs `EditorContextProvider`'s effect
  // needs, persistently for this file's lifetime. Also dynamically imported
  // so its own module graph can't resolve `@/components/ui` ahead of the
  // hook above.
  const { installPersistentDefaultDom } =
    await import("@/test/react-render-harness");
  installPersistentDefaultDom();

  // `Tooltip` (rendered by the real `TextFormatSection`) unconditionally
  // calls `createPortal(tooltip, document.body)` once `document` exists, so
  // `body` needs a `nodeType` react-dom's portal guard accepts. Matches
  // `mobile-text-format-section.test.tsx`.
  (globalThis.document as unknown as { body: { nodeType: number } }).body = {
    nodeType: 1,
  } as never;
});

afterEach(() => {
  globalThis.__mobileEditingSheetBottomSheetCalls = [];
});

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "mobile-editing-sheet-test",
    nodes: [VisualNode],
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

/** Selects the full text of a fresh paragraph, producing a real `"range"` ctx. */
function selectParagraphText(editor: LexicalEditor, text: string) {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(text);
        paragraph.append(textNode);
        $getRoot().clear().append(paragraph);
        textNode.select(0, text.length);
      },
      { discrete: true },
    );
  });
}

/** Bridges a fixed `activeVisual` into the real `VisualPanelProvider`. */
function PanelController({
  activeVisual,
}: {
  activeVisual: { nodeKey: string; visualId: string } | null;
}) {
  const { setActiveVisual } = useVisualPanel();
  useEffect(() => {
    setActiveVisual(activeVisual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVisual]);
  return null;
}

function mount(
  editor: LexicalEditor,
  options: {
    activeVisual?: { nodeKey: string; visualId: string } | null;
    editable?: boolean;
  } = {},
): { renderer: ReactTestRenderer; unmount: () => void } {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContext },
        createElement(
          EditorContextProvider,
          null,
          createElement(
            VisualSvgRegistryProvider,
            null,
            createElement(
              VisualPanelProvider,
              null,
              createElement(PanelController, {
                activeVisual: options.activeVisual ?? null,
              }),
              createElement(MobileEditingSheetHost, {
                editable: options.editable ?? true,
              }),
            ),
          ),
        ),
      ),
    );
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

function findButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => node.type === "button",
  ) as ReactTestInstance[];
}

function findByAriaLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance | undefined {
  return findButtons(renderer).find(
    (button) => button.props["aria-label"] === label,
  );
}

test("editable=false renders nothing and never invokes useEditingSurface (no providers required)", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(MobileEditingSheetHost, { editable: false }),
    );
  });
  assert.equal(renderer.toJSON(), null);
  act(() => {
    renderer.unmount();
  });
});

test("renders nothing (no FAB) when there is no selection — mode is always 'none'", () => {
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);
  assert.equal(findButtons(renderer).length, 0);
  assert.equal(globalThis.__mobileEditingSheetBottomSheetCalls.length, 0);
  unmount();
});

test("'text-format' group: FAB opens the sheet composing the real GenerateVisualSection + TextFormatSection, and Close closes it", () => {
  const editor = makeEditor();
  selectParagraphText(editor, "Selected range");
  const { renderer, unmount } = mount(editor);

  const fab = findByAriaLabel(renderer, "Open text formatting");
  assert.ok(fab, "expected the text-format FAB");
  assert.equal(fab?.props["aria-expanded"], false);
  assert.equal(fab?.props["aria-haspopup"], "dialog");

  // Closed: BottomSheetSurface stub was called with open=false, nothing else rendered.
  assert.equal(renderer.root.findAllByType(GenerateVisualSection).length, 0);
  assert.equal(renderer.root.findAllByType(TextFormatSection).length, 0);

  act(() => {
    (fab?.props as { onClick: () => void }).onClick();
  });

  const reopenedFab = findByAriaLabel(renderer, "Open text formatting");
  assert.equal(reopenedFab?.props["aria-expanded"], true);

  const calls = globalThis.__mobileEditingSheetBottomSheetCalls;
  assert.ok(calls.some((call) => call.open === true));
  assert.equal(calls[calls.length - 1]?.ariaLabel, "Editing panel");

  // The real sibling sections are mounted (composition wiring), not duplicated internals.
  assert.equal(renderer.root.findAllByType(GenerateVisualSection).length, 1);
  assert.equal(renderer.root.findAllByType(TextFormatSection).length, 1);
  assert.equal(renderer.root.findAllByType(VisualContextSection).length, 0);

  const panelTitle = renderer.root.findAll((node) =>
    typeof node.type === "string" && Array.isArray(node.props.children)
      ? false
      : node.props.children === "Text format",
  );
  assert.ok(panelTitle.length > 0, "expected the 'Text format' panel title");

  const closeButton = findByAriaLabel(renderer, "Close editing panel");
  assert.ok(closeButton, "expected the close button");

  act(() => {
    (closeButton?.props as { onClick: () => void }).onClick();
  });

  const closedFab = findByAriaLabel(renderer, "Open text formatting");
  assert.equal(closedFab?.props["aria-expanded"], false);
  const lastCall =
    globalThis.__mobileEditingSheetBottomSheetCalls[
      globalThis.__mobileEditingSheetBottomSheetCalls.length - 1
    ];
  assert.equal(lastCall?.open, false);
  assert.equal(renderer.root.findAllByType(GenerateVisualSection).length, 0);
  assert.equal(renderer.root.findAllByType(TextFormatSection).length, 0);

  unmount();
});

test("'visual-edit' group (VisualPanel activeVisual, real ctx path): composes the real VisualContextSection with the 'Visual' label", () => {
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor, {
    // A nodeKey that doesn't exist in the document: `useEditingSurface`
    // only needs `activeVisual` to be truthy to resolve group "visual-edit"
    // (VisualCard's real production wiring); `VisualContextSection` itself
    // safely resolves to a null render when the node can't be found, which
    // keeps this composition test from needing to also stand up the
    // separately-tested `VisualContextPopover` render path (#1959, see
    // `mobile-visual-context-section.test.tsx`).
    activeVisual: { nodeKey: "does-not-exist", visualId: "vis-x" },
  });

  const fab = findByAriaLabel(renderer, "Open visual editing");
  assert.ok(fab, "expected the visual-edit FAB");

  act(() => {
    (fab?.props as { onClick: () => void }).onClick();
  });

  assert.equal(renderer.root.findAllByType(VisualContextSection).length, 1);
  assert.equal(renderer.root.findAllByType(GenerateVisualSection).length, 0);
  assert.equal(renderer.root.findAllByType(TextFormatSection).length, 0);

  const panelTitle = renderer.root.findAll(
    (node) => node.props.children === "Visual",
  );
  assert.ok(panelTitle.length > 0, "expected the 'Visual' panel title");

  unmount();
});
