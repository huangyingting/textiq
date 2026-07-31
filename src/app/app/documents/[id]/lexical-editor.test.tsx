/**
 * Direct behavior coverage for `LexicalEditor` (#1958).
 *
 * `LexicalEditor` is the document editor's composition root: it wires ~20
 * independently-scoped collaborators (real-time collaboration, autosave,
 * the eight sibling surfaces already covered elsewhere in this batch, and a
 * dozen more document-chrome components) around a real `LexicalComposer`.
 * Nearly everything it composes already has its own dedicated, exhaustive
 * test — `use-lexical-collaboration.test.ts`, `use-collaboration.test.ts`,
 * `use-autosave.test.ts`, `editor-plugins.test.ts`, and the six sibling
 * `*.test.tsx` files in this directory for `BlockSparkPlugin`,
 * `FloatingTextToolbar`, `ImportPlugin`, `InsertMenuPlugin`,
 * `FloatingTableToolbar`, and `VisualCard` — so re-exercising their
 * internals here would duplicate that coverage. Every one of those is
 * stubbed to an identity marker (or, for the five *hooks* driving
 * collaboration/autosave/plugin-assembly, a controllable recording stub)
 * via a `node:module` `registerHooks` interception (the pattern established
 * by `./page.test.tsx` and `./visual-card.test.tsx`), so this file can
 * inspect the exact config/props/args `LexicalEditor` itself computes and
 * wires them with, without ever executing any collaborator's own logic.
 * `framer-motion` is stubbed the same way (to plain forwardRef host
 * elements) since several *kept-real* chrome primitives this file exercises
 * transitively (`Popover`/`Tooltip`, used by the in-file `DocumentStyleButton`
 * and every `EditorToolbarButton`) mount a real `motion.div`/`AnimatePresence`
 * even while closed; see the shared discovery documented against
 * `./visual-card.test.tsx`'s framer-motion stub for why overriding
 * `matchMedia` to force reduced-motion is insufficient on its own.
 *
 * Everything else is real: the `LexicalComposer`/`LexicalCollaboration`
 * composition itself (so `initialConfig` — namespace/theme/nodes/
 * editable/onError — is asserted against the actual config object Lexical
 * receives), `EditorPluginHost`/`createEditorPlugin` (the plugin
 * registration mechanism), the lightweight context providers
 * (`EditorContextProvider`, `VisualPanelProvider`, `RightSurfaceProvider`,
 * `VisualSvgRegistryProvider`, `VisualNodeRendererProvider`), the real
 * `useCollaborationEditable` gate, and the handful of components/functions
 * defined directly in `lexical-editor.tsx` (`DocumentStyleButton`,
 * `RoutedPresentButton`, `RoutedDocumentExportButton`, `PageGuidesButton`) —
 * these are the file's own composition/wiring logic and are exercised
 * directly against a real, live headless-adjacent editor. That editor
 * handle is obtained via `InsertMenuCapture` (below), a real component
 * built from this file's own top-level `useLexicalComposerContext`/
 * `$getRoot`/`$createVisualNode` imports, which the `./insert-menu` stub
 * proxies to — always-mounted, and thus a convenient seam onto the live
 * editor, since every other document plugin is stubbed away. The capture
 * can't live inside the stub module itself: that module is loaded via
 * `registerHooks` while `./lexical-editor` is require()'d (Node's
 * `require(esm)` interop), and `@lexical/react`/`lexical`'s dev/prod
 * dispatch shims use a genuine top-level await, which throws
 * `ERR_REQUIRE_ASYNC_MODULE` under that synchronous path — proxying to a
 * component built from this file's own (plain, async-loaded) imports of
 * those same packages sidesteps it entirely. Also unrelated to any stub:
 * `next/link` (the always-rendered "Back"/"Slides" affordances) throws
 * "self is not defined" under `react-test-renderer` — `mountEditor` sets
 * `globalThis.self` for the duration of each test, matching the same fix
 * in `./block-spark.test.tsx`'s "Upgrade link" test.
 *
 * Coverage: the fixed `initialConfig` Lexical receives; the `onError`
 * error-boundary callback; the two independent read-only paths
 * (`canEdit=false` hides edit affordances and shows the "Read-only" badge;
 * collaboration-not-ready gates `editable` on every collaboration-gated
 * child even when `canEdit=true`, without showing that badge);
 * `canManage`-gated `ShareButton`; collaboration state wired into
 * `createCoreEditorPlugins`; every core + document plugin registered
 * exactly once via `EditorPluginHost`; the debounced save action correctly
 * scoped to `documentId`; the title-seed effect firing once collaboration
 * becomes ready; `RoutedPresentButton`'s `getVisuals` reading the real,
 * live document; `RoutedDocumentExportButton`'s prop wiring; the in-file
 * `PageGuidesButton` toggle; the in-file `DocumentStyleButton`'s
 * editable-gated `disabled` state; and the live word-count/reading-time
 * stats plus autosave status label.
 *
 * Reference-identity across "the test file's own import" and "the
 * production file's transitive import" of the *same* specifier is
 * unreliable under simultaneous `registerHooks` + `tsx` loader hooks (see
 * `./visual-card.test.tsx`), so every lookup below matches rendered
 * instances by component *name* rather than by imported reference — for
 * both the stubbed markers and shared real components like `LexicalComposer`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, before, beforeEach, describe, test } from "node:test";
import { createElement, useEffect } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, type LexicalEditor as LexicalEditorInstance } from "lexical";

import {
  installFakeDom,
  mount,
  textOf,
  unmount,
} from "@/test/lexical-component-harness";
import { $createVisualNode } from "@/lib/lexical/visual-node";
import type { Visual } from "@/lib/visual/schema";

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

type CollabState = {
  providerFactory: (...args: unknown[]) => unknown;
  status: string;
  ready: boolean;
  synced: boolean;
  degraded: boolean;
  peers: unknown[];
  awareness: unknown;
  cursorColor: string;
  ytitle: unknown;
  localOrigin: symbol;
  seedTitle: (title: string) => void;
};

type AutosaveStatus = "saved" | "pending" | "saving" | "error";

declare global {
  var __lexicalEditorTestState: {
    collab: CollabState;
    autosaveStatus: AutosaveStatus;
    editor: LexicalEditorInstance | null;
    insertVisual: ((visual: Visual) => string) | null;
    calls: {
      useLexicalCollaboration: unknown[];
      useYText: unknown[];
      useLexicalAutosave: unknown[];
      createCoreEditorPlugins: Array<{
        documentId: string;
        providerFactory: unknown;
        initialStateJson: string | null;
        userName: string;
        cursorColor: string;
        ready: boolean;
        degraded: boolean;
        synced: boolean;
        editable: boolean;
        onText: (text: string) => void;
        onChange: (...args: unknown[]) => void;
      }>;
      fetchDeckJson: unknown[];
      saveDocumentLexical: Array<[string, string]>;
      seedTitle: string[];
    };
  };
  var __lexicalEditorInsertMenuCapture: (() => null) | undefined;
}

function defaultCollab(): CollabState {
  return {
    providerFactory: () => ({}),
    status: "connected",
    ready: true,
    synced: true,
    degraded: false,
    peers: [],
    awareness: {},
    cursorColor: "#6366f1",
    ytitle: "dummy-ytext",
    localOrigin: Symbol("local"),
    seedTitle: (title: string) => {
      globalThis.__lexicalEditorTestState.calls.seedTitle.push(title);
    },
  };
}

function resetState(): void {
  globalThis.__lexicalEditorTestState = {
    collab: defaultCollab(),
    autosaveStatus: "saved",
    editor: null,
    insertVisual: null,
    calls: {
      useLexicalCollaboration: [],
      useYText: [],
      useLexicalAutosave: [],
      createCoreEditorPlugins: [],
      fetchDeckJson: [],
      saveDocumentLexical: [],
      seedTitle: [],
    },
  };
}

/**
 * Real component — built from the test file's own (async-loaded, top-level-
 * await-safe) imports of `useLexicalComposerContext`/`$getRoot`/
 * `$createVisualNode` — that the `./insert-menu` stub proxies to. See that
 * stub's comment for why the capture can't simply live inside the stub
 * module itself.
 */
function InsertMenuCapture(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const state = globalThis.__lexicalEditorTestState;
    state.editor = editor;
    state.insertVisual = (visual: Visual) => {
      let key = "";
      editor.update(
        () => {
          const node = $createVisualNode(visual);
          key = node.getKey();
          $getRoot().append(node);
        },
        { discrete: true },
      );
      return key;
    };
  }, [editor]);
  return null;
}
globalThis.__lexicalEditorInsertMenuCapture = InsertMenuCapture;

const stubPrefix = "textiq-lexical-editor-test:";

/** A no-op identity-marker component: `export function ${name}() { return null; }`. */
function identityStub(name: string): string {
  return `export function ${name}() { return null; }\n`;
}

const stubbedModules = new Map<string, string>([
  [
    "framer-motion",
    `
      import { createElement, forwardRef } from "react";

      // Several kept-real chrome primitives this file exercises transitively
      // (Popover/Tooltip, via the in-file DocumentStyleButton and every
      // EditorToolbarButton) mount a real motion.div/AnimatePresence even
      // while closed. See ./visual-card.test.tsx's framer-motion stub for the
      // full discovery — overriding matchMedia to force reduced-motion is
      // insufficient (useReducedMotion caches its result at module/process
      // scope), so the whole package is stubbed to inert host elements.
      const MOTION_PROPS = new Set([
        "initial", "animate", "exit", "transition", "variants",
        "whileHover", "whileTap", "whileFocus", "whileDrag", "layout", "layoutId",
      ]);
      export const motion = new Proxy({}, {
        get(_target, tag) {
          return forwardRef(function MotionStub(props, ref) {
            const rest = {};
            for (const key in props) {
              if (!MOTION_PROPS.has(key)) rest[key] = props[key];
            }
            return createElement(tag, { ...rest, ref });
          });
        },
      });
      export function AnimatePresence(props) {
        return props.children ?? null;
      }
      export function useReducedMotion() {
        return true;
      }
    `,
  ],
  [
    "@/lib/collab/use-lexical-collaboration",
    `
      export function useLexicalCollaboration(opts) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.useLexicalCollaboration.push(opts);
        return { ...state.collab };
      }
    `,
  ],
  [
    "@/lib/collab/use-collaboration",
    `
      export function useYText(ytext, options) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.useYText.push({ ytext, options });
        return { value: options.initial, onChange: () => {} };
      }
    `,
  ],
  [
    "@/lib/lexical/use-autosave",
    `
      export function useLexicalAutosave(opts) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.useLexicalAutosave.push(opts);
        return { status: state.autosaveStatus, handleChange: () => {} };
      }
    `,
  ],
  [
    "@/lib/lexical/editor-plugins",
    `
      import { createElement } from "react";
      export function createCoreEditorPlugins(opts) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.createCoreEditorPlugins.push(opts);
        return [
          {
            id: "core-plugins-marker",
            render: () => createElement("div", { "data-core-plugins-marker": "" }),
          },
        ];
      }
    `,
  ],
  [
    "./actions",
    `
      export async function fetchDeckJson(documentId) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.fetchDeckJson.push(documentId);
        return null;
      }
      export async function saveDocumentLexical(documentId, json) {
        const state = globalThis.__lexicalEditorTestState;
        state.calls.saveDocumentLexical.push([documentId, json]);
      }
    `,
  ],
  [
    "./insert-menu",
    `
      // Always-mounted document plugin, and thus a convenient place to hand
      // rendering off to a real component defined in the *test file's own*
      // module graph (see InsertMenuCapture below) — every other document/
      // core plugin is fully stubbed away, so this is the only seam onto the
      // live editor. This stub deliberately imports nothing beyond a
      // \`globalThis\` side channel: importing "@lexical/react/..." or
      // "lexical" directly from a module loaded through this file's
      // \`registerHooks\` interception forces Node to resolve those packages'
      // dev/prod \`.node.mjs\` shims (which use a genuine top-level await)
      // via the synchronous require(esm) path taken when the CJS-transpiled
      // production \`./lexical-editor\` module requires an intercepted
      // specifier, which throws ERR_REQUIRE_ASYNC_MODULE. Proxying to a
      // component built from the test file's own (async-loaded, TLA-safe)
      // imports of those same packages sidesteps that entirely.
      export function InsertMenuPlugin(props) {
        const capture = globalThis.__lexicalEditorInsertMenuCapture;
        return capture ? capture(props) : null;
      }
    `,
  ],
  ["./block-spark", identityStub("BlockSparkPlugin")],
  ["./floating-text-toolbar", identityStub("FloatingTextToolbar")],
  ["./table-controls", identityStub("FloatingTableToolbar")],
  ["./visual-card", identityStub("VisualCard")],
  ["./import-plugin", identityStub("ImportPlugin")],
  ["./insert-visual-plugin", identityStub("InsertVisualPlugin")],
  ["./source-block-jump", identityStub("SourceBlockJumpPlugin")],
  ["./inline-comments-layer", identityStub("InlineCommentsLayer")],
  ["./mobile-editing-sheet", identityStub("MobileEditingSheetHost")],
  ["./presence", identityStub("Presence")],
  ["./overall-adjustments-panel", identityStub("OverallAdjustmentsPanel")],
  ["./share-button", identityStub("ShareButton")],
  ["./tag-control", identityStub("TagControl")],
  ["./undo-redo-controls", identityStub("UndoRedoControls")],
  ["./version-history-panel", identityStub("VersionHistoryPanel")],
  [
    "@/components/editor/document-export-button",
    identityStub("DocumentExportButton"),
  ],
  [
    "@/components/editor/page-break-indicator",
    identityStub("PageBreakIndicator"),
  ],
  ["@/components/editor/present-button", identityStub("PresentButton")],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
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
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

let LexicalEditor: typeof import("./lexical-editor").LexicalEditor;

before(async () => {
  ({ LexicalEditor } =
    (await import("./lexical-editor")) as typeof import("./lexical-editor"));
});

let restoreDom: (() => void) | null = null;
let renderer: ReactTestRenderer | null = null;
let originalSelf: unknown;

beforeEach(() => {
  resetState();
});

afterEach(() => {
  if (renderer) {
    unmount(renderer);
    renderer = null;
  }
  if (restoreDom) {
    restoreDom();
    restoreDom = null;
  }
  (globalThis as { self?: unknown }).self = originalSelf;
});

type EditorProps = Parameters<typeof LexicalEditor>[0];

function baseProps(overrides: Partial<EditorProps> = {}): EditorProps {
  return {
    documentId: "doc-1",
    initialTitle: "Draft Title",
    userId: "user-1",
    userName: "Ann",
    canEdit: true,
    canManage: false,
    workspaceName: "Acme",
    initialComments: [],
    initialTags: [],
    allTags: [],
    initialStateJson: null,
    initialDeckJson: null,
    initialIsShared: false,
    initialShareId: null,
    initialSlug: null,
    initialShareExpiresAt: null,
    initialShareEmbedEnabled: true,
    initialSharePresentEnabled: true,
    initialSharePasscodeEnabled: false,
    initialShareMetadataMode: "generic",
    initialShareDiscoverable: false,
    ...overrides,
  };
}

function mountEditor(overrides: Partial<EditorProps> = {}): ReactTestRenderer {
  restoreDom = installFakeDom();
  // `next/link`'s `Link` (the "Back"/"Slides" affordances, unconditionally
  // rendered) throws "self is not defined" under react-test-renderer (no
  // jsdom) — its `useIntersection` prefetch effect falls back to `next`'s
  // `request-idle-callback` shim, which references the free variable `self`
  // unconditionally once its own `typeof self` guard fails. See the same
  // fix in `./block-spark.test.tsx`'s "Upgrade link" test.
  originalSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = globalThis;
  const props = baseProps(overrides);
  renderer = mount(createElement(LexicalEditor, props));
  return renderer;
}

/** Matches by component *name* rather than reference — see file doc comment. */
function findByName(
  host: ReactTestRenderer | ReactTestInstance,
  name: string,
): ReactTestInstance | null {
  const root = "root" in host ? host.root : host;
  const matches = root.findAll(
    (instance) =>
      typeof instance.type === "function" &&
      (instance.type as { name?: string }).name === name,
  );
  return matches.length > 0 ? matches[0] : null;
}

function findAllByName(
  host: ReactTestRenderer | ReactTestInstance,
  name: string,
): ReactTestInstance[] {
  const root = "root" in host ? host.root : host;
  return root.findAll(
    (instance) =>
      typeof instance.type === "function" &&
      (instance.type as { name?: string }).name === name,
  );
}

/**
 * Matches only *host* elements (`instance.type` is a string tag, e.g.
 * `"button"`/`"span"`) whose real, rendered `aria-label` equals `label`.
 * Restricting to host elements matters here: several components (e.g.
 * `Popover`) receive an `aria-label` prop themselves and forward it to an
 * internal, conditionally-rendered panel — matching on *any* instance would
 * find the component's own received prop even when nothing with that
 * accessible name is actually in the DOM tree.
 */
function findByAriaLabel(
  r: ReactTestRenderer,
  label: string,
): ReactTestInstance | null {
  const matches = r.root.findAll(
    (instance) =>
      typeof instance.type === "string" &&
      instance.props["aria-label"] === label,
  );
  return matches.length > 0 ? matches[0] : null;
}

const FIXTURE_VISUAL: Visual = {
  kind: "list",
  nodes: [
    { id: "n1", label: "One" },
    { id: "n2", label: "Two" },
  ],
  edges: [],
} as unknown as Visual;

describe("LexicalEditor", () => {
  test("renders LexicalComposer with the fixed initialConfig (namespace/theme/nodes/read-only shell/onError)", () => {
    const r = mountEditor();

    const composer = findByName(r, "LexicalComposer");
    assert.ok(composer, "expected a LexicalComposer in the tree");
    const initialConfig = composer!.props.initialConfig as {
      namespace: string;
      theme: Record<string, unknown>;
      nodes: Array<{ getType(): string }>;
      editable: boolean;
      editorState: unknown;
      onError: unknown;
    };

    assert.equal(initialConfig.namespace, "TextIQLexicalEditor");
    assert.equal(initialConfig.editable, false);
    assert.equal(initialConfig.editorState, null);
    assert.equal(typeof initialConfig.onError, "function");

    assert.equal(initialConfig.theme.paragraph, "mb-3 leading-7");
    assert.equal(
      initialConfig.theme.link,
      "text-ds-accent-text underline underline-offset-2",
    );

    const nodeTypes = initialConfig.nodes
      .map((klass) => klass.getType())
      .sort();
    assert.deepEqual(nodeTypes, [
      "heading",
      "horizontalrule",
      "link",
      "list",
      "listitem",
      "quote",
      "table",
      "tablecell",
      "tablerow",
      "visual",
    ]);
  });

  test("onError logs the error to console.error (error boundary)", () => {
    const r = mountEditor();
    const composer = findByName(r, "LexicalComposer")!;
    const onError = composer.props.initialConfig.onError as (
      error: Error,
    ) => void;

    const original = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      const error = new Error("boom");
      onError(error);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.[0], error);
    } finally {
      console.error = original;
    }
  });

  test("canEdit=false hides edit-only affordances and shows the Read-only badge; canEdit=true shows them and hides it", () => {
    const readOnly = mountEditor({ canEdit: false });
    assert.equal(findByName(readOnly, "ImportPlugin"), null);
    assert.equal(findByName(readOnly, "UndoRedoControls"), null);
    assert.equal(findByAriaLabel(readOnly, "Open slide editor"), null);
    assert.equal(findByAriaLabel(readOnly, "Style"), null);
    assert.match(textOf(readOnly.root), /Read-only/);
    unmount(readOnly);
    renderer = null;

    const editable = mountEditor({ canEdit: true });
    assert.ok(findByName(editable, "ImportPlugin"));
    assert.ok(findByName(editable, "UndoRedoControls"));
    assert.ok(findByAriaLabel(editable, "Open slide editor"));
    assert.ok(findByAriaLabel(editable, "Style"));
    assert.doesNotMatch(textOf(editable.root), /Read-only/);
  });

  test("canManage gates ShareButton independently of canEdit", () => {
    const withoutManage = mountEditor({ canManage: false });
    assert.equal(findByName(withoutManage, "ShareButton"), null);
    unmount(withoutManage);
    renderer = null;

    const withManage = mountEditor({
      canManage: true,
      initialIsShared: true,
      initialShareId: "share-1",
    });
    const share = findByName(withManage, "ShareButton");
    assert.ok(share);
    assert.equal(share!.props.id, "doc-1");
    assert.equal(share!.props.initialIsShared, true);
    assert.equal(share!.props.initialShareId, "share-1");
    assert.equal(share!.props.documentTitle, "Draft Title");
  });

  test("editable is derived from canEdit AND collaboration readiness, and flows to every collaboration-gated child", () => {
    globalThis.__lexicalEditorTestState.collab.ready = true;
    const ready = mountEditor({ canEdit: true });
    assert.equal(
      findByName(ready, "FloatingTableToolbar")!.props.editable,
      true,
    );
    assert.equal(
      findByName(ready, "MobileEditingSheetHost")!.props.editable,
      true,
    );
    assert.equal(findByName(ready, "UndoRedoControls")!.props.editable, true);
    unmount(ready);
    renderer = null;

    // canEdit=true but collaboration not yet ready: editable is still false,
    // and (unlike canEdit=false) the "Read-only" badge does NOT appear — this
    // is a distinct, permission-independent read-only path.
    globalThis.__lexicalEditorTestState.collab.ready = false;
    const notReady = mountEditor({ canEdit: true });
    assert.equal(
      findByName(notReady, "FloatingTableToolbar")!.props.editable,
      false,
    );
    assert.equal(
      findByName(notReady, "MobileEditingSheetHost")!.props.editable,
      false,
    );
    assert.equal(
      findByName(notReady, "UndoRedoControls")!.props.editable,
      false,
    );
    assert.doesNotMatch(textOf(notReady.root), /Read-only/);
    unmount(notReady);
    renderer = null;

    // canEdit=false gates editable regardless of collaboration readiness.
    globalThis.__lexicalEditorTestState.collab.ready = true;
    const noPermission = mountEditor({ canEdit: false });
    assert.equal(
      findByName(noPermission, "FloatingTableToolbar")!.props.editable,
      false,
    );
  });

  test("wires collaboration state into createCoreEditorPlugins", () => {
    globalThis.__lexicalEditorTestState.collab = {
      ...globalThis.__lexicalEditorTestState.collab,
      ready: true,
      degraded: true,
      synced: false,
      cursorColor: "#abcdef",
    };
    const r = mountEditor({
      documentId: "doc-42",
      userName: "Bea",
      initialStateJson: '{"seed":true}',
    });
    void r;

    const calls =
      globalThis.__lexicalEditorTestState.calls.createCoreEditorPlugins;
    assert.equal(calls.length, 1);
    const args = calls[0]!;
    assert.equal(args.documentId, "doc-42");
    assert.equal(args.userName, "Bea");
    assert.equal(args.initialStateJson, '{"seed":true}');
    assert.equal(args.cursorColor, "#abcdef");
    assert.equal(args.ready, true);
    assert.equal(args.degraded, true);
    assert.equal(args.synced, false);
    assert.equal(args.editable, true);
    assert.equal(typeof args.onText, "function");
    assert.equal(typeof args.onChange, "function");
    assert.equal(
      args.providerFactory,
      globalThis.__lexicalEditorTestState.collab.providerFactory,
    );
  });

  test("renders every core + document plugin exactly once via EditorPluginHost", () => {
    const r = mountEditor({ initialComments: [{ id: "c1" }] as never });

    assert.equal(
      r.root.findAll((i) => i.props["data-core-plugins-marker"] !== undefined)
        .length,
      1,
    );
    for (const name of [
      "InsertMenuPlugin",
      "BlockSparkPlugin",
      "InsertVisualPlugin",
      "SourceBlockJumpPlugin",
      "FloatingTextToolbar",
      "FloatingTableToolbar",
      "InlineCommentsLayer",
    ]) {
      assert.equal(
        findAllByName(r, name).length,
        1,
        `expected exactly one ${name}`,
      );
    }

    const inlineComments = findByName(r, "InlineCommentsLayer")!;
    assert.equal(inlineComments.props.documentId, "doc-1");
    assert.equal(inlineComments.props.currentUserId, "user-1");
    assert.deepEqual(inlineComments.props.initialComments, [{ id: "c1" }]);
  });

  test("documentId scopes the debounced save action to saveDocumentLexical", async () => {
    mountEditor({ documentId: "doc-99" });
    const call = globalThis.__lexicalEditorTestState.calls
      .useLexicalAutosave[0] as {
      save: (json: string) => Promise<void>;
    };

    await call.save('{"root":"json"}');

    assert.deepEqual(
      globalThis.__lexicalEditorTestState.calls.saveDocumentLexical,
      [["doc-99", '{"root":"json"}']],
    );
  });

  test("seeds the collaborative title once collaboration becomes ready", () => {
    globalThis.__lexicalEditorTestState.collab.ready = false;
    const r = mountEditor({ initialTitle: "Seeded Title" });
    assert.deepEqual(globalThis.__lexicalEditorTestState.calls.seedTitle, []);

    globalThis.__lexicalEditorTestState.collab.ready = true;
    act(() => {
      r.update(
        createElement(
          LexicalEditor,
          baseProps({ initialTitle: "Seeded Title" }),
        ),
      );
    });

    assert.deepEqual(globalThis.__lexicalEditorTestState.calls.seedTitle, [
      "Seeded Title",
    ]);
  });

  test("RoutedPresentButton's getVisuals reads the real, live document", () => {
    const r = mountEditor({ documentId: "doc-7" });
    const insertVisual = globalThis.__lexicalEditorTestState.insertVisual!;
    const key = insertVisual(FIXTURE_VISUAL);
    assert.ok(key);

    const present = findByName(r, "PresentButton")!;
    assert.equal(present.props.documentId, "doc-7");
    assert.equal(present.props.documentTitle, "Draft Title");
    assert.equal(typeof present.props.getVisuals, "function");

    const visuals = (
      present.props.getVisuals as () => Record<string, Visual>
    )();
    const ids = Object.keys(visuals);
    assert.equal(ids.length, 1);
    assert.deepEqual(visuals[ids[0]!], FIXTURE_VISUAL);
  });

  test("RoutedDocumentExportButton passes documentId/documentTitle/initialDeckJson through to DocumentExportButton", () => {
    const r = mountEditor({
      documentId: "doc-8",
      initialDeckJson: { slides: [] } as never,
    });
    const exportButton = findByName(r, "DocumentExportButton")!;
    assert.equal(exportButton.props.documentId, "doc-8");
    assert.equal(exportButton.props.documentTitle, "Draft Title");
    assert.deepEqual(exportButton.props.initialDeckJson, { slides: [] });
  });

  test("PageGuidesButton toggles the PageBreakIndicator and its own label/aria-pressed", () => {
    const r = mountEditor();
    assert.equal(findByName(r, "PageBreakIndicator"), null);
    const button = findByAriaLabel(r, "Page guides")!;
    assert.ok(button);
    assert.equal(button.props["aria-pressed"], false);

    act(() => {
      button.props.onClick();
    });

    assert.ok(findByName(r, "PageBreakIndicator"));
    const hideButton = findByAriaLabel(r, "Hide page-break guides")!;
    assert.equal(hideButton.props["aria-pressed"], true);

    act(() => {
      hideButton.props.onClick();
    });

    assert.equal(findByName(r, "PageBreakIndicator"), null);
    assert.ok(findByAriaLabel(r, "Page guides"));
  });

  test("DocumentStyleButton is disabled until the editor is editable", () => {
    globalThis.__lexicalEditorTestState.collab.ready = false;
    const notEditable = mountEditor({ canEdit: true });
    const trigger = findByAriaLabel(notEditable, "Style")!;
    assert.equal(trigger.props.disabled, true);
    unmount(notEditable);
    renderer = null;

    globalThis.__lexicalEditorTestState.collab.ready = true;
    const editable = mountEditor({ canEdit: true });
    const enabledTrigger = findByAriaLabel(editable, "Style")!;
    assert.equal(enabledTrigger.props.disabled, false);
  });

  test("renders live word-count/reading-time stats driven by the core plugins' onText callback, and the autosave status label", () => {
    globalThis.__lexicalEditorTestState.autosaveStatus = "saving";
    const r = mountEditor();
    const onText =
      globalThis.__lexicalEditorTestState.calls.createCoreEditorPlugins[0]!
        .onText;

    act(() => {
      onText("one two three");
    });

    const statsLabel = findByAriaLabel(r, "Document statistics")!;
    assert.match(textOf(statsLabel), /1 min read/);
    assert.match(textOf(statsLabel), /3 words/);

    const status = r.root.findAll(
      (i) => i.props.role === "status" && i.props["aria-live"] === "polite",
    )[0]!;
    assert.equal(textOf(status), "Saving…");
  });

  test("maps every autosave status to its display label", () => {
    const cases: Array<[AutosaveStatus, string]> = [
      ["saved", "All changes saved"],
      ["pending", "Unsaved changes…"],
      ["saving", "Saving…"],
      ["error", "Couldn't save changes"],
    ];

    for (const [status, label] of cases) {
      globalThis.__lexicalEditorTestState.autosaveStatus = status;
      const r = mountEditor();
      const statusEl = r.root.findAll(
        (i) => i.props.role === "status" && i.props["aria-live"] === "polite",
      )[0]!;
      assert.equal(textOf(statusEl), label);
      unmount(r);
      renderer = null;
      restoreDom!();
      restoreDom = null;
    }
  });
});
