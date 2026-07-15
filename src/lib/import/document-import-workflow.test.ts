import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import type {
  DocumentImportActionPort,
  ImportedDocumentPayload,
} from "@/lib/action-ports";
import { IMPORT_MAX_UPLOAD_BYTES } from "@/lib/limits/assets";

import {
  DOCUMENT_IMPORT_MAX_SIZE_LABEL,
  useDocumentImportWorkflow,
} from "./document-import-workflow";

const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [msg] = args;
  if (
    typeof msg === "string" &&
    msg.startsWith("react-test-renderer is deprecated")
  )
    return;
  origConsoleError(...args);
};

after(() => {
  console.error = origConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Creates a File stub reporting a specific size without allocating large buffers. */
function fakeFile(
  size: number,
  name = "test.pdf",
  type = "application/pdf",
): File {
  const f = new File([], name, { type });
  Object.defineProperty(f, "size", { value: size, configurable: true });
  return f;
}

type HookResult = ReturnType<typeof useDocumentImportWorkflow>;

/** Renders the hook in a minimal component and returns a live reference. */
function renderWorkflow(
  port: DocumentImportActionPort,
  onImported: (p: ImportedDocumentPayload) => void = () => {},
): { ref: { current: HookResult | null }; unmount: () => void } {
  const hookRef: { current: HookResult | null } = { current: null };

  function Harness() {
    hookRef.current = useDocumentImportWorkflow({
      onImported,
      surface: "dashboard",
      port,
    });
    return null;
  }

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Harness));
  });

  return {
    ref: hookRef,
    unmount: () => act(() => renderer.unmount()),
  };
}

// ── client preflight boundary ─────────────────────────────────────────────────

test("client preflight: file at exactly IMPORT_MAX_UPLOAD_BYTES is not rejected and port is called", async () => {
  let importFileCalled = false;
  const port: DocumentImportActionPort = {
    async importFile() {
      importFileCalled = true;
      return { ok: true, data: { markdown: "# Test", title: "Test" } };
    },
  };

  const { ref, unmount } = renderWorkflow(port);

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES));
  });

  assert.ok(
    importFileCalled,
    "port.importFile must be called for a file at exactly IMPORT_MAX_UPLOAD_BYTES",
  );
  assert.notEqual(
    ref.current!.state.status,
    "error",
    "state must not be error for a file at exactly IMPORT_MAX_UPLOAD_BYTES",
  );

  unmount();
});

test("client preflight: file at IMPORT_MAX_UPLOAD_BYTES + 1 is rejected before upload", async () => {
  let importFileCalled = false;
  const port: DocumentImportActionPort = {
    async importFile() {
      importFileCalled = true;
      return { ok: true, data: { markdown: "# Test", title: "Test" } };
    },
  };

  const { ref, unmount } = renderWorkflow(port);

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES + 1));
  });

  assert.ok(
    !importFileCalled,
    "port.importFile must NOT be called for a file exceeding IMPORT_MAX_UPLOAD_BYTES",
  );
  assert.equal(
    ref.current!.state.status,
    "error",
    "state must be error when file exceeds IMPORT_MAX_UPLOAD_BYTES",
  );

  unmount();
});

test("client preflight: rejection error message includes '20 MB' wording", async () => {
  const port: DocumentImportActionPort = {
    async importFile() {
      return { ok: true, data: { markdown: "", title: "" } };
    },
  };

  const { ref, unmount } = renderWorkflow(port);

  await act(async () => {
    await ref.current!.processFile(fakeFile(IMPORT_MAX_UPLOAD_BYTES + 1));
  });

  assert.equal(ref.current!.state.status, "error");
  const state = ref.current!.state;
  if (state.status === "error") {
    assert.ok(
      state.message.includes(DOCUMENT_IMPORT_MAX_SIZE_LABEL),
      `error message "${state.message}" must include '${DOCUMENT_IMPORT_MAX_SIZE_LABEL}'`,
    );
  }

  unmount();
});

test("client preflight: no upload call occurs for an oversized file", async () => {
  const uploadLog: string[] = [];
  const port: DocumentImportActionPort = {
    async importFile(f) {
      uploadLog.push(f.name);
      return {
        ok: false,
        error: {
          code: "internal",
          status: 500,
          message: "should not reach upload",
        },
      };
    },
  };

  const { ref, unmount } = renderWorkflow(port);

  await act(async () => {
    await ref.current!.processFile(
      fakeFile(IMPORT_MAX_UPLOAD_BYTES + 1, "huge.pdf"),
    );
  });

  assert.deepEqual(
    uploadLog,
    [],
    "upload must not be attempted for oversized file",
  );

  unmount();
});
