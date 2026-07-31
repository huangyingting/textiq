import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type TestRendererOptions,
} from "react-test-renderer";

import "@/test/react-render-harness";
import type { ImportActionResult } from "@/lib/action-ports";

import { ImportButton } from "./import-button";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mountImportButton(
  props: {
    onImport: (markdown: string) => void;
    importFile: (
      file: File,
    ) => Promise<ImportActionResult<{ markdown: string }>>;
    label?: string;
    iconOnly?: boolean;
  },
  options?: TestRendererOptions,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ImportButton {...props} />, options);
  });
  return renderer;
}

function findInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    "aria-label": "Import document file",
  });
}

function findImportButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" &&
      instance.props["aria-label"] === "Import document",
  );
}

function findAlert(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ role: "alert" });
}

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

async function selectFile(
  renderer: ReactTestRenderer,
  file: File,
): Promise<void> {
  const target = { files: [file], value: "mock.md" };
  await act(async () => {
    await findInput(renderer).props.onChange({
      target,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  });
  assert.equal(target.value, "");
}

describe("ImportButton", () => {
  test("idle render exposes the toolbar action and accepted file formats", () => {
    const renderer = mountImportButton({
      onImport: () => undefined,
      importFile: async () => ({ ok: true, data: { markdown: "# Ok" } }),
    });
    try {
      const input = findInput(renderer);
      assert.equal(input.props.type, "file");
      assert.equal(input.props.accept, ".md,.html,.htm,.docx,.pptx,.pdf");
      assert.equal(findImportButton(renderer).props.disabled, false);
      assert.throws(() => findAlert(renderer));
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a selected file is parsed and forwarded to the editor", async () => {
    const imported: string[] = [];
    const renderer = mountImportButton({
      onImport: (markdown) => imported.push(markdown),
      importFile: async () => ({ ok: true, data: { markdown: "# Hello" } }),
    });
    try {
      await selectFile(
        renderer,
        new File(["# Hello"], "notes.md", { type: "text/markdown" }),
      );
      assert.deepEqual(imported, ["# Hello"]);
      assert.equal(findImportButton(renderer).props.disabled, false);
      assert.throws(() => findAlert(renderer));
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("an oversized file is rejected before parsing", async () => {
    let importCalls = 0;
    const renderer = mountImportButton({
      onImport: () => undefined,
      importFile: async () => {
        importCalls += 1;
        return { ok: true, data: { markdown: "unused" } };
      },
    });
    try {
      const huge = new File(["x"], "huge.pdf", { type: "application/pdf" });
      Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
      await selectFile(renderer, huge);
      assert.match(textOf(findAlert(renderer)), /too large/i);
      assert.equal(importCalls, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a typed parse failure exposes direct retry and dismiss actions", async () => {
    let inputClicks = 0;
    const renderer = mountImportButton(
      {
        onImport: () => undefined,
        importFile: async () => ({
          ok: false,
          error: { code: "malformed", status: 422, message: "bad file" },
        }),
      },
      {
        createNodeMock: (element) =>
          element.type === "input" ? { click: () => (inputClicks += 1) } : null,
      },
    );
    try {
      await selectFile(
        renderer,
        new File(["bad"], "bad.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      assert.match(textOf(findAlert(renderer)), /bad file/);
      assert.throws(() => findImportButton(renderer));

      const retry = renderer.root.find(
        (instance) =>
          instance.type === "button" && instance.props.children === "Try again",
      );
      act(() => retry.props.onClick());
      assert.equal(inputClicks, 1);

      act(() =>
        renderer.root
          .findByProps({ "aria-label": "Dismiss error" })
          .props.onClick(),
      );
      assert.throws(() => findAlert(renderer));
      assert.equal(findImportButton(renderer).props.disabled, false);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a thrown parse error becomes a recoverable network message", async () => {
    const renderer = mountImportButton({
      onImport: () => undefined,
      importFile: async () => Promise.reject(new Error("network down")),
    });
    try {
      await selectFile(
        renderer,
        new File(["x"], "notes.md", { type: "text/markdown" }),
      );
      assert.match(textOf(findAlert(renderer)), /Could not reach the server/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("an editor apply failure remains recoverable and is not counted as import success", async () => {
    const renderer = mountImportButton({
      onImport: () => {
        throw new Error("Lexical apply failed");
      },
      importFile: async () => ({
        ok: true,
        data: { markdown: "# Parsed" },
      }),
    });
    try {
      await selectFile(
        renderer,
        new File(["# Parsed"], "notes.md", { type: "text/markdown" }),
      );
      assert.match(
        textOf(findAlert(renderer)),
        /Could not apply imported content/,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("Next navigation control flow escapes import recovery and releases the upload boundary", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    let importCalls = 0;
    const imported: string[] = [];
    const renderer = mountImportButton({
      onImport: (markdown) => imported.push(markdown),
      importFile: async () => {
        importCalls += 1;
        if (importCalls === 1) throw redirectError;
        return { ok: true, data: { markdown: "# Recovered" } };
      },
    });
    try {
      const target = {
        files: [new File(["x"], "first.md", { type: "text/markdown" })],
        value: "first.md",
      };
      await assert.rejects(
        () =>
          findInput(renderer).props.onChange({
            target,
          } as unknown as React.ChangeEvent<HTMLInputElement>),
        (error: unknown) => error === redirectError,
      );
      assert.equal(target.value, "");

      await selectFile(
        renderer,
        new File(["second"], "second.md", { type: "text/markdown" }),
      );
      assert.equal(importCalls, 2);
      assert.deepEqual(imported, ["# Recovered"]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("pending parse disables the toolbar action and ignores duplicate selections", async () => {
    let resolveImport!: (value: {
      ok: true;
      data: { markdown: string };
    }) => void;
    let importCalls = 0;
    const imported: string[] = [];
    const renderer = mountImportButton({
      onImport: (markdown) => imported.push(markdown),
      importFile: () => {
        importCalls += 1;
        return new Promise((resolve) => {
          resolveImport = resolve;
        });
      },
    });
    try {
      const first = new File(["first"], "first.md", {
        type: "text/markdown",
      });
      const duplicate = new File(["duplicate"], "duplicate.md", {
        type: "text/markdown",
      });
      act(() => {
        findInput(renderer).props.onChange({
          target: { files: [first], value: "first.md" },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
        findInput(renderer).props.onChange({
          target: { files: [duplicate], value: "duplicate.md" },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      const pendingButton = findImportButton(renderer);
      assert.equal(pendingButton.props.disabled, true);
      assert.match(textOf(pendingButton), /Importing…/);
      assert.equal(importCalls, 1);

      await act(async () => {
        resolveImport({ ok: true, data: { markdown: "done" } });
        await waitForAsyncDrain();
      });
      assert.deepEqual(imported, ["done"]);
      assert.equal(findImportButton(renderer).props.disabled, false);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
