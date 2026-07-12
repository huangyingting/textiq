/**
 * Direct contract coverage for `ImportButton` (issue #1933).
 *
 * `ImportButton` has no Lexical/context dependency, so it is mounted with a
 * plain `react-test-renderer` tree (no `document`/`window` globals are
 * installed — `Tooltip` inside `EditorToolbarButton` safely no-ops when
 * `document` is undefined). Upload/error transitions come from
 * `useDocumentImportWorkflow`, which always uses its default
 * `routeDocumentImportPort` (calling the global `fetch`) since `ImportButton`
 * does not expose an injectable port — so `globalThis.fetch` is mocked per
 * scenario.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";

import { ImportButton } from "./import-button";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mountImportButton(props: {
  onImport: (markdown: string) => void;
  label?: string;
  compact?: boolean;
  iconOnly?: boolean;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ImportButton {...props} />);
  });
  return renderer;
}

function findInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    "aria-label": "Import document file",
  });
}

function findAlert(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "alert" });
}

async function selectFile(
  renderer: ReactTestRenderer,
  file: File,
): Promise<void> {
  const target = { files: [file], value: "mock.md" };
  await act(async () => {
    findInput(renderer).props.onChange({
      target,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    await waitForAsyncDrain();
  });
}

describe("ImportButton (drop-zone / full mode)", () => {
  test("idle render exposes the drop-zone, hidden file input, and no error alert", () => {
    const renderer = mountImportButton({ onImport: () => undefined });
    try {
      const dropZone = renderer.root.findByProps({ role: "button" });
      assert.equal(
        dropZone.props["aria-label"],
        "Import document — drag and drop or click to browse",
      );
      assert.equal(dropZone.props.tabIndex, 0);
      const input = findInput(renderer);
      assert.equal(input.props.type, "file");
      assert.equal(input.props.accept, ".md,.html,.htm,.docx,.pptx,.pdf");
      assert.throws(() => findAlert(renderer));
      assert.match(JSON.stringify(dropZone.props.className), /cursor-pointer/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("drag-over/drag-leave toggle the dragging affordance without uploading", () => {
    const renderer = mountImportButton({ onImport: () => undefined });
    try {
      const preventDefault = () => undefined;
      act(() => {
        renderer.root
          .findByProps({ role: "button" })
          .props.onDragOver({ preventDefault });
      });
      assert.match(
        JSON.stringify(
          renderer.root.findByProps({ role: "button" }).props.className,
        ),
        /border-\[var\(--ds-accent/,
      );
      act(() => {
        renderer.root.findByProps({ role: "button" }).props.onDragLeave();
      });
      assert.doesNotMatch(
        JSON.stringify(
          renderer.root.findByProps({ role: "button" }).props.className,
        ),
        /border-\[var\(--ds-accent/,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("dropping a file uploads it and calls onImport with the extracted markdown", async () => {
    const imported: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ markdown: "# Hello" })) as typeof fetch;
    const renderer = mountImportButton({
      onImport: (markdown) => imported.push(markdown),
    });
    try {
      const file = new File(["# Hello"], "notes.md", { type: "text/markdown" });
      const preventDefault = () => undefined;
      await act(async () => {
        renderer.root.findByProps({ role: "button" }).props.onDrop({
          preventDefault,
          dataTransfer: { files: [file] },
        });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(imported, ["# Hello"]);
      // After a successful import the workflow returns to idle: no alert,
      // no persistent "Importing…" label.
      assert.throws(() => findAlert(renderer));
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("an oversized file is rejected client-side with a retryable error and no upload", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return jsonResponse({ markdown: "unused" });
    }) as typeof fetch;
    const renderer = mountImportButton({ onImport: () => undefined });
    try {
      const huge = new File(["x"], "huge.pdf", { type: "application/pdf" });
      Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
      await selectFile(renderer, huge);
      const alert = findAlert(renderer);
      assert.match(
        alert.props.children[0].props?.children ?? alert.props.children,
        /too large/i,
      );
      assert.equal(fetchCalls, 0);

      // "Try again" re-opens the file picker; "Dismiss error" clears state.
      const dismiss = renderer.root.findByProps({
        "aria-label": "Dismiss error",
      });
      act(() => dismiss.props.onClick());
      assert.throws(() => findAlert(renderer));
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a failed import shows the server error message and supports retry via the file picker", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ error: "Unsupported file format." }, 400)) as typeof fetch;
    const renderer = mountImportButton({ onImport: () => undefined });
    try {
      const file = new File(["bad"], "bad.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await selectFile(renderer, file);
      const alert = findAlert(renderer);
      const text =
        alert.props.children[0].props?.children ?? alert.props.children;
      assert.match(text, /Unsupported file format\./);
      const tryAgain = renderer.root.findByProps({ children: "Try again" });
      assert.equal(tryAgain.type, "button");
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a rejected fetch (network failure) recovers with a friendly, dismissible error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const renderer = mountImportButton({ onImport: () => undefined });
    try {
      const file = new File(["x"], "notes.md", { type: "text/markdown" });
      await selectFile(renderer, file);
      const alert = findAlert(renderer);
      const text =
        alert.props.children[0].props?.children ?? alert.props.children;
      assert.match(text, /Could not reach the server/);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("shows the uploading status while a request is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;
    const renderer = mountImportButton({ onImport: () => undefined });
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
      const status = renderer.root.findByProps({ role: "status" });
      assert.equal(status.props.children, "Uploading and validating file…");
      const dropZone = renderer.root.findByProps({ role: "button" });
      assert.match(
        JSON.stringify(dropZone.props.className),
        /cursor-not-allowed/,
      );

      await act(async () => {
        resolveFetch(jsonResponse({ markdown: "done" }));
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.throws(() => renderer.root.findByProps({ role: "status" }));
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ImportButton (compact/toolbar mode)", () => {
  test("compact idle render shows an icon+label toolbar button, no drop-zone", () => {
    const renderer = mountImportButton({
      onImport: () => undefined,
      compact: true,
      label: "Import",
    });
    try {
      assert.throws(() => renderer.root.findByProps({ role: "button" }));
      const button = renderer.root.find(
        (instance) =>
          instance.type === "button" &&
          instance.props["aria-label"] === "Import",
      );
      assert.equal(button.props.disabled, false);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("compact error state renders a dismissible inline alert instead of the button", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ error: "bad file" }, 400)) as typeof fetch;
    const renderer = mountImportButton({
      onImport: () => undefined,
      compact: true,
    });
    try {
      const file = new File(["x"], "notes.md", { type: "text/markdown" });
      await selectFile(renderer, file);
      const alert = findAlert(renderer);
      assert.match(JSON.stringify(alert.props.className), /text-xs/);
      assert.throws(() =>
        renderer.root.findByProps({ "aria-label": "Import document" }),
      );
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });
});
