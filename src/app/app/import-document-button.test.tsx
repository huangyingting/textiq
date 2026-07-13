/**
 * Direct contract coverage for `ImportDocumentButton` (issue #1956) — the
 * dashboard "Import document" action.
 *
 * `createDocumentFromImport` (from `./actions`) is already fully covered by
 * `src/app/app/actions.test.ts`, so this stubs the sibling `./actions`
 * module via `node:module`'s `registerHooks` (same pattern used by
 * `src/app/app/settings/page.test.tsx` and
 * `src/app/app/onboarding-checklist.test.tsx`) rather than re-testing the
 * server action or its `@/lib/prisma`/`@/lib/session` dependencies. The stub
 * is scoped to the `"./actions"` specifier, which only
 * `import-document-button.tsx` resolves within this file's module graph —
 * safe because Node's test runner isolates each test file into its own
 * process.
 *
 * `useDocumentImportWorkflow` always uses its default `routeDocumentImportPort`
 * (calling the global `fetch`) since `ImportDocumentButton` does not expose
 * an injectable port — matching `src/components/editor/import-button.test.tsx`'s
 * approach of mocking `globalThis.fetch` per scenario instead of duplicating
 * `document-import-workflow.test.ts`'s coverage of the hook/port itself.
 *
 * Mounted directly with `react-test-renderer` (no `document`/`window`
 * globals needed — this component renders no Tooltip/portal content).
 * `handleImported`'s `startTransition(async () => { await
 * createDocumentFromImport(...) })` result is fire-and-forget (the
 * component discards `isPending` from `useTransition`), so — unlike
 * `onboarding-checklist.tsx` — no pending UI is gated on it; assertions
 * simply await a drain tick to observe the stubbed action call.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

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

type ImportActionsTestState = {
  calls: { markdown: string; title: string }[];
};

const globalForActions = globalThis as typeof globalThis & {
  __importActionsTestState: ImportActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__importActionsTestState = { calls: [] };
}
resetActionsState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "import-document-button-actions:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  createDocumentFromImport: async (markdown, title) => {
    globalThis.__importActionsTestState.calls.push({ markdown, title });
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ButtonModule = typeof import("./import-document-button");
let ImportDocumentButton: ButtonModule["ImportDocumentButton"];

before(async () => {
  const mod = await import("./import-document-button");
  ImportDocumentButton = mod.ImportDocumentButton;
});

beforeEach(resetActionsState);

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mountButton(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(ImportDocumentButton, { className: "primary" }),
    );
  });
  return renderer;
}

function findInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ "aria-label": "Import a document file" });
}

function findButton(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ "aria-label": "Import document" });
}

function findAlert(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "alert" });
}

/**
 * Flattens a mounted `ReactTestInstance`'s committed text content. Reads
 * `.children` (the reconciler's rendered-instance list), not `.props.children`
 * — the latter holds the original, pre-render JSX elements, whose `_owner`
 * fiber back-reference makes `JSON.stringify` throw on a circular structure.
 */
function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

async function selectFile(
  renderer: ReactTestRenderer,
  file: File,
): Promise<void> {
  await act(async () => {
    findInput(renderer).props.onChange({
      target: { files: [file], value: "mock" },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    await waitForAsyncDrain();
    await waitForAsyncDrain();
  });
}

describe("ImportDocumentButton", () => {
  test("idle render: hidden file input + button, no error alert", () => {
    const renderer = mountButton();
    try {
      const input = findInput(renderer);
      assert.equal(input.props.type, "file");
      assert.equal(input.props.accept, ".md,.html,.htm,.docx,.pptx,.pdf");
      const button = findButton(renderer);
      assert.equal(button.props.disabled, false);
      assert.match(textOf(button), /Import/);
      assert.throws(() => findAlert(renderer));
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("selecting a file uploads it, then calls createDocumentFromImport with the extracted markdown and a title derived from the file name", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ markdown: "# Hello world" })) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["# Hello world"], "my-great_notes.md", {
        type: "text/markdown",
      });
      await selectFile(renderer, file);

      assert.deepEqual(globalForActions.__importActionsTestState.calls, [
        { markdown: "# Hello world", title: "my great notes" },
      ]);
      // Back to idle: no error alert, button re-enabled.
      assert.throws(() => findAlert(renderer));
      assert.equal(findButton(renderer).props.disabled, false);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("shows the importing label and disables the button while the upload is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["x"], "notes.md", { type: "text/markdown" });
      act(() => {
        findInput(renderer).props.onChange({
          target: { files: [file], value: "notes.md" },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      const button = findButton(renderer);
      assert.equal(button.props.disabled, true);
      assert.match(textOf(button), /Importing…/);

      await act(async () => {
        resolveFetch(jsonResponse({ markdown: "done" }));
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(findButton(renderer).props.disabled, false);
      assert.equal(globalForActions.__importActionsTestState.calls.length, 1);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a server-reported import error renders a dismissible, retryable alert and never calls createDocumentFromImport", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ error: "Unsupported file format." }, 400)) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["bad"], "bad.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await selectFile(renderer, file);

      const alert = findAlert(renderer);
      assert.match(textOf(alert), /Unsupported file format\./);
      assert.equal(globalForActions.__importActionsTestState.calls.length, 0);

      const retry = renderer.root.find(
        (el) => el.type === "button" && el.props.children === "retry",
      );
      assert.ok(retry, "expected a retry button inside the error alert");
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a network failure surfaces a friendly, retryable error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["x"], "notes.md", { type: "text/markdown" });
      await selectFile(renderer, file);
      const alert = findAlert(renderer);
      assert.match(textOf(alert), /Could not reach the server/);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("an oversized file is rejected client-side (no fetch call) with a retryable error", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return jsonResponse({ markdown: "unused" });
    }) as typeof fetch;
    const renderer = mountButton();
    try {
      const huge = new File(["x"], "huge.pdf", { type: "application/pdf" });
      Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
      await selectFile(renderer, huge);
      const alert = findAlert(renderer);
      assert.match(textOf(alert), /too large/i);
      assert.equal(fetchCalls, 0);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("reset: clicking retry clears the error alert and re-enables the import button", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ error: "bad file" }, 400)) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["x"], "notes.md", { type: "text/markdown" });
      await selectFile(renderer, file);
      assert.ok(findAlert(renderer));

      const retry = renderer.root.find(
        (el) => el.type === "button" && el.props.children === "retry",
      );
      act(() => {
        (retry.props.onClick as () => void)();
      });

      assert.throws(() => findAlert(renderer));
      assert.equal(findButton(renderer).props.disabled, false);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });
});
