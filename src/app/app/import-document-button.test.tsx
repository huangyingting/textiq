/**
 * Direct contract coverage for `ImportDocumentButton` (issue #1956) — the
 * dashboard "Import document" action.
 *
 * The button now uses durable `/api/import` create mode and client-side
 * navigation on success; this suite stubs `next/navigation`'s `useRouter`
 * via `node:module` `registerHooks` to assert navigation happens only after
 * the route reports durable success.
 *
 * `useDocumentImportCreationWorkflow` uses its default route port (global
 * `fetch`) since `ImportDocumentButton` does not expose an injectable port,
 * so these tests mock `globalThis.fetch` per scenario.
 *
 * Mounted directly with `react-test-renderer` (no `document`/`window`
 * globals needed — this component renders no Tooltip/portal content).
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

type ImportRouterTestState = {
  pushes: string[];
};

const globalForRouter = globalThis as typeof globalThis & {
  __importRouterTestState: ImportRouterTestState;
};

function resetRouterState(): void {
  globalForRouter.__importRouterTestState = { pushes: [] };
}
resetRouterState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const navigationStubUrl = "import-document-button-navigation:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") {
      return { url: navigationStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === navigationStubUrl) {
      return {
        format: "module",
        source: `
          export function useRouter() {
            return {
              push(url) {
                globalThis.__importRouterTestState.pushes.push(url);
              },
            };
          }
        `,
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

beforeEach(resetRouterState);

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

  test("selecting a file uploads it and navigates only after durable persistence succeeds", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({
        ok: true,
        documentId: "doc-1",
        documentPath: "/app/documents/doc-1",
      })) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["# Hello world"], "my-great_notes.md", {
        type: "text/markdown",
      });
      await selectFile(renderer, file);

      assert.deepEqual(globalForRouter.__importRouterTestState.pushes, [
        "/app/documents/doc-1",
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
      assert.equal(findInput(renderer).props.disabled, true);
      assert.equal(button.props.disabled, true);
      assert.equal(button.props["aria-busy"], true);
      assert.match(textOf(button), /Importing…/);
      assert.match(
        textOf(renderer.root.findByProps({ role: "status" })),
        /Importing/i,
      );

      await act(async () => {
        resolveFetch(
          jsonResponse({
            ok: true,
            documentId: "doc-2",
            documentPath: "/app/documents/doc-2",
          }),
        );
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(findInput(renderer).props.disabled, false);
      assert.equal(findButton(renderer).props.disabled, false);
      assert.equal(findButton(renderer).props["aria-busy"], false);
      assert.throws(() => renderer.root.findByProps({ role: "status" }));
      assert.deepEqual(globalForRouter.__importRouterTestState.pushes, [
        "/app/documents/doc-2",
      ]);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a malformed success payload is rejected in create workflow and does not navigate", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({
        ok: true,
        markdown: "# Missing durable metadata",
      })) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["# Hello world"], "my-great_notes.md", {
        type: "text/markdown",
      });
      await selectFile(renderer, file);

      const alert = findAlert(renderer);
      assert.match(textOf(alert), /invalid import response/i);
      assert.equal(globalForRouter.__importRouterTestState.pushes.length, 0);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a server-reported import error renders a dismissible, retryable alert and never navigates", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: "unsupported",
            status: 415,
            message: "Unsupported file format.",
          },
        },
        415,
      )) as typeof fetch;
    const renderer = mountButton();
    try {
      const file = new File(["bad"], "bad.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await selectFile(renderer, file);

      const alert = findAlert(renderer);
      assert.match(textOf(alert), /Unsupported file format\./);
      assert.equal(globalForRouter.__importRouterTestState.pushes.length, 0);

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
      return jsonResponse({
        ok: true,
        documentId: "unused",
        documentPath: "/app/documents/unused",
      });
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
      jsonResponse(
        {
          ok: false,
          error: {
            code: "malformed",
            status: 400,
            message: "bad file",
          },
        },
        400,
      )) as typeof fetch;
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
