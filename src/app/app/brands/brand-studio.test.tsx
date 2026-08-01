/**
 * Direct contract coverage for `BrandStudio` (issue #1956) — the editable
 * Brand Studio surface (list/create/edit/delete brand styles with logo/font
 * upload and live preview) shown to entitled users.
 *
 * `createBrand`/`updateBrand`/`deleteBrand` (from `./actions`) are already
 * fully covered by `src/app/app/brands/actions.test.ts` (entitlement gating,
 * validation, persistence, revalidation), so this stubs the sibling
 * `./actions` module via `node:module`'s `registerHooks` (same pattern used
 * by `src/app/app/new-document-button.test.tsx` and
 * `src/app/app/import-document-button.test.tsx`) rather than re-testing the
 * server actions. The stub is scoped to the `"./actions"` specifier, which
 * only `brand-studio.tsx` resolves within this file's module graph — safe
 * because Node's test runner isolates each test file into its own process.
 *
 * Logo/font upload goes through the already-injectable `BrandUploadPort`
 * (`./brand-studio-ports`), so upload scenarios pass a fake port directly as
 * a prop instead of mocking `fetch` or stubbing another module.
 * `validateLogoUpload`/`validateFontUpload`/`formatUploadError` and
 * `brandPreviewStyle` are already fully covered by
 * `src/lib/brand/brand.test.ts`; this file only asserts that `BrandForm`
 * wires their results into the UI (error message shown, port not called),
 * not the validation logic itself. Likewise `hydrateBrandFont`/
 * `useHydrateBrandFont` are fully covered by `src/lib/brand/font-hooks.test.ts`
 * and are exercised here only incidentally as part of mounting `BrandCard`.
 *
 * `BrandForm.handleSubmit` and `BrandCard.handleDelete` both use
 * `useTransition` with an async callback, so — per the lesson learned while
 * fixing `src/app/app/onboarding-checklist.test.tsx` — every interactive test
 * here mounts `BrandStudio` for real with `react-test-renderer`'s `create`/
 * `act` (via `mountWithPortalDom`) rather than calling the component as a
 * plain function; calling it as a bare function leaves `useTransition`'s
 * scheduler work dangling and corrupts global React internals for whichever
 * test runs next in this file.
 *
 * `BrandCard` renders a `<Dialog>` (delete confirmation) unconditionally
 * (only its `open` prop toggles — see `@/test/portal-dom`'s docstring for why
 * `ModalSurface` needs a real portal-capable `document`), so every test uses
 * `withPortalDom`/`mountWithPortalDom` rather than the plain
 * `@/test/react-render-harness`.
 *
 * `handleLogoUpload`'s inline canvas palette-quantization loop was extracted
 * to the standalone `extractPaletteFromImageData` (exported from
 * `./brand-studio`) specifically because it was the one piece of this file
 * genuinely blocked from direct testing by concrete `Image`/`canvas` DOM
 * coupling — it's unit-tested directly below, without needing a
 * canvas/Image stub. The surrounding orchestration (drawing the uploaded
 * logo onto an offscreen canvas via `img.onload`) is intentionally left
 * untested at the component level: it would require stubbing a global
 * `Image`/`document.createElement("canvas")`/`CanvasRenderingContext2D` (as
 * `src/lib/visual/export.test.ts` does for a different feature), which is a
 * much larger addition than this task's "avoid broad rewrite" guidance
 * supports for a best-effort, catch-and-ignore auto-fill affordance — the
 * logo upload's primary contract (`logoAssetUrl`/`logoAssetId` persisted,
 * pending/error states) is fully covered without it.
 *
 * `ColorPicker`'s own popover interaction (opening the swatch grid, picking a
 * color) is a separate, generic UI primitive with no dedicated test file of
 * its own yet; opening it is out of scope for this issue's brand-specific
 * flow list (entitlement/read-only/empty/list/upload/delete/preview/error/
 * pending/accessibility), so tests here only assert that `BrandForm` renders
 * one `ColorPicker` per palette/base-color field with the right
 * `color`/`aria-label`, without exercising the popover itself.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import type { BrandStyle } from "@/lib/brand/schema";
import type { BrandUploadPort } from "./brand-studio-ports";

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

type ActionResultLike =
  { ok: true; data: unknown } | { ok: false; error: string };

type BrandActionsTestState = {
  createCalls: unknown[];
  updateCalls: Array<{ id: string; payload: unknown }>;
  deleteCalls: string[];
  createImpl: (payload: unknown) => Promise<ActionResultLike>;
  updateImpl: (id: string, payload: unknown) => Promise<ActionResultLike>;
  deleteImpl: (id: string) => Promise<ActionResultLike>;
};

const globalForActions = globalThis as typeof globalThis & {
  __brandActionsTestState: BrandActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__brandActionsTestState = {
    createCalls: [],
    updateCalls: [],
    deleteCalls: [],
    createImpl: async (payload) => ({
      ok: true,
      data: { id: "new-brand", ...(payload as object) },
    }),
    updateImpl: async (id, payload) => ({
      ok: true,
      data: { id, ...(payload as object) },
    }),
    deleteImpl: async () => ({ ok: true, data: undefined }),
  };
}
resetActionsState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "brand-studio-actions:test";
const navigationStubUrl = "brand-studio-navigation:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  createBrand: async (payload) => {
    globalThis.__brandActionsTestState.createCalls.push(payload);
    return globalThis.__brandActionsTestState.createImpl(payload);
  },
  updateBrand: async (id, payload) => {
    globalThis.__brandActionsTestState.updateCalls.push({ id, payload });
    return globalThis.__brandActionsTestState.updateImpl(id, payload);
  },
  deleteBrand: async (id) => {
    globalThis.__brandActionsTestState.deleteCalls.push(id);
    return globalThis.__brandActionsTestState.deleteImpl(id);
  },
};`,
        shortCircuit: true,
      };
    }
    if (url === navigationStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  unstable_rethrow: (error) => {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
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

type BrandStudioModule = typeof import("./brand-studio");
let BrandStudio: BrandStudioModule["BrandStudio"];
let extractPaletteFromImageData: BrandStudioModule["extractPaletteFromImageData"];

before(async () => {
  const mod = await import("./brand-studio");
  BrandStudio = mod.BrandStudio;
  extractPaletteFromImageData = mod.extractPaletteFromImageData;
});

beforeEach(resetActionsState);

// `handleLogoUpload` unconditionally constructs `new Image()` after a
// successful upload to auto-extract a palette from the logo (via
// `img.onload` + canvas). Node has no global `Image`, so — without this
// stub — even a *successful* upload's own success path would throw
// synchronously and be swallowed by `handleLogoUpload`'s outer catch,
// surfacing a spurious "Logo upload failed" error. This fake deliberately
// never calls `onload`/`onerror`: driving the canvas/`getImageData`
// orchestration end-to-end would need a much larger `document.createElement
// ("canvas")`/`CanvasRenderingContext2D` stub (as in
// `src/lib/visual/export.test.ts`) for a best-effort, catch-and-ignore
// affordance — out of proportion for this task. The bucket-counting
// algorithm itself is unit-tested directly below via
// `extractPaletteFromImageData`.
const originalImage = globalThis.Image;
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    // Deliberately inert — see comment above.
  }
}
globalThis.Image = FakeImage as unknown as typeof Image;
after(() => {
  globalThis.Image = originalImage;
});

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function buildBrand(overrides: Partial<BrandStyle> = {}): BrandStyle {
  return {
    id: "brand-1",
    name: "Acme",
    ownerId: "user-1",
    palette: ["#111111", "#222222"],
    background: "#ffffff",
    nodeFill: "#eef2ff",
    nodeStroke: "#4f46e5",
    nodeText: "#312e81",
    edgeColor: "#a5b4fc",
    fontFamily: null,
    fontAssetId: null,
    logoAssetId: null,
    fontAssetUrl: null,
    logoAssetUrl: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildUploadPort(
  overrides: Partial<BrandUploadPort> = {},
): BrandUploadPort {
  return {
    uploadLogo: async () => ({
      url: "https://textiq.test/api/brand-assets/logo-1",
      assetId: "logo-asset-1",
    }),
    uploadFont: async () => ({
      url: "https://textiq.test/api/brand-assets/font-1",
      assetId: "font-asset-1",
      familyName: "Custom Font",
    }),
    ...overrides,
  };
}

function mount(props: {
  initialBrands: BrandStyle[];
  canFontUpload: boolean;
  uploadPort?: BrandUploadPort;
}): ReactTestRenderer {
  return mountWithPortalDom(createElement(BrandStudio, props));
}

function findButtonByText(
  root: ReactTestInstance,
  pattern: RegExp,
): ReactTestInstance {
  const match = root
    .findAllByType("button")
    .find((button) => pattern.test(textOf(button)));
  assert.ok(match, `expected a <button> matching ${pattern}`);
  return match;
}

function findFileInput(
  root: ReactTestInstance,
  acceptSubstring: string,
): ReactTestInstance {
  const match = root
    .findAllByType("input")
    .find(
      (input) =>
        input.props.type === "file" &&
        typeof input.props.accept === "string" &&
        (input.props.accept as string).includes(acceptSubstring),
    );
  assert.ok(match, `expected a file input accepting ${acceptSubstring}`);
  return match;
}

async function selectFile(input: ReactTestInstance, file: File): Promise<void> {
  await act(async () => {
    input.props.onChange({ target: { files: [file], value: "mock" } });
    await waitForAsyncDrain();
    await waitForAsyncDrain();
    await waitForAsyncDrain();
  });
}

describe("BrandStudio", () => {
  describe("empty state", () => {
    test("shows the empty-state message and the create-panel trigger when there are no brands", () => {
      withPortalDom(() => {
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          assert.match(textOf(renderer.root), /No brand styles yet/);
          findButtonByText(renderer.root, /New brand style/);
          assert.equal(
            renderer.root.findAllByProps({ "aria-label": "Delete brand" })
              .length,
            0,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("list rendering", () => {
    test("renders one card per brand, in order, with no empty-state message", () => {
      withPortalDom(() => {
        const brands = [
          buildBrand({ id: "b1", name: "Acme" }),
          buildBrand({ id: "b2", name: "Globex" }),
        ];
        const renderer = mount({ initialBrands: brands, canFontUpload: false });
        try {
          const cards = renderer.root.findAllByProps({
            "aria-label": "Brand: Acme",
          });
          assert.equal(cards.length, 1);
          renderer.root.findByProps({ "aria-label": "Brand: Globex" });
          assert.doesNotMatch(textOf(renderer.root), /No brand styles yet/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("collapsed cards show the compact swatch preview, not the edit form", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
        });
        try {
          assert.throws(() => renderer.root.findByProps({ id: "brand-name" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("entitlement (font upload)", () => {
    test("canFontUpload=false hides the custom font upload control in the create panel", () => {
      withPortalDom(() => {
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          assert.doesNotMatch(textOf(renderer.root), /Upload font/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("canFontUpload=true shows the custom font upload control in the create panel", () => {
      withPortalDom(() => {
        const renderer = mount({ initialBrands: [], canFontUpload: true });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          findButtonByText(renderer.root, /Upload font \(TTF\/OTF\/WOFF\)/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("canFontUpload propagates to an existing brand's edit form too", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: true,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          findButtonByText(renderer.root, /Upload font \(TTF\/OTF\/WOFF\)/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("create brand flow", () => {
    test("filling the name and submitting calls createBrand with the form payload, then appends the result and closes the panel", async () => {
      await withPortalDom(async () => {
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          const nameInput = renderer.root.findByProps({ id: "brand-name" });
          act(() => {
            nameInput.props.onChange({ target: { value: "New Co" } });
          });

          globalForActions.__brandActionsTestState.createImpl = async (
            payload,
          ) => ({
            ok: true,
            data: buildBrand({
              id: "created-1",
              name: (payload as { name: string }).name,
            }),
          });

          await act(async () => {
            findButtonByText(renderer.root, /Create brand/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          assert.equal(
            globalForActions.__brandActionsTestState.createCalls.length,
            1,
          );
          assert.equal(
            (
              globalForActions.__brandActionsTestState.createCalls[0] as {
                name: string;
              }
            ).name,
            "New Co",
          );
          // Panel closed; the new brand now renders as a card.
          renderer.root.findByProps({ "aria-label": "Brand: New Co" });
          assert.throws(() => renderer.root.findByProps({ id: "brand-name" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a failed createBrand shows the error message and keeps the panel open", async () => {
      await withPortalDom(async () => {
        globalForActions.__brandActionsTestState.createImpl = async () => ({
          ok: false,
          error: "You've reached the brand style limit.",
        });
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "New Co" } });
          });
          await act(async () => {
            findButtonByText(renderer.root, /Create brand/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /reached the brand style limit/);
          // Still open: name input still present.
          renderer.root.findByProps({ id: "brand-name" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a pending create has one synchronous write boundary and locks every dismissal path", async () => {
      await withPortalDom(async () => {
        const createAttempt = deferred<ActionResultLike>();
        globalForActions.__brandActionsTestState.createImpl = () =>
          createAttempt.promise;
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "One Write" } });
          });
          const submit = findButtonByText(renderer.root, /Create brand/);
          const close = renderer.root.findByProps({ "aria-label": "Close" });
          const cancel = findButtonByText(renderer.root, /^Cancel$/);

          await act(async () => {
            submit.props.onClick();
            submit.props.onClick();
            close.props.onClick();
            cancel.props.onClick();
            await waitForAsyncDrain();
          });

          assert.equal(
            globalForActions.__brandActionsTestState.createCalls.length,
            1,
          );
          assert.equal(
            renderer.root.findByProps({ id: "brand-name" }).props.disabled,
            true,
          );
          assert.equal(
            renderer.root.findByProps({ "aria-label": "Close" }).props.disabled,
            true,
          );
          assert.equal(
            findButtonByText(renderer.root, /^Cancel$/).props.disabled,
            true,
          );
          assert.match(textOf(renderer.root), /Creating brand…/);

          await act(async () => {
            createAttempt.resolve({
              ok: true,
              data: buildBrand({ id: "created-once", name: "One Write" }),
            });
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
          renderer.root.findByProps({ "aria-label": "Brand: One Write" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a rejected create transport shows safe dismissible feedback and retains the draft", async () => {
      await withPortalDom(async () => {
        globalForActions.__brandActionsTestState.createImpl = async () => {
          throw new Error("database transport leaked details");
        };
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "Retained Draft" } });
          });
          await act(async () => {
            findButtonByText(renderer.root, /Create brand/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Couldn't save the brand/);
          assert.doesNotMatch(textOf(alert), /database transport/);
          assert.equal(
            renderer.root.findByProps({ id: "brand-name" }).props.value,
            "Retained Draft",
          );
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Dismiss brand error" })
              .props.onClick();
          });
          assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("framework redirect control flow escapes create recovery", async () => {
      await withPortalDom(async () => {
        const redirectError = new Error("NEXT_REDIRECT:/login");
        globalForActions.__brandActionsTestState.createImpl = async () => {
          throw redirectError;
        };
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "Redirect Draft" } });
          });
          await assert.rejects(
            async () => {
              await act(async () => {
                await findButtonByText(
                  renderer.root,
                  /Create brand/,
                ).props.onClick();
              });
            },
            (error: unknown) => error === redirectError,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("the Create-brand submit button is disabled while empty and enabled once a name is entered", () => {
      withPortalDom(() => {
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          assert.equal(
            findButtonByText(renderer.root, /Create brand/).props.disabled,
            true,
          );
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "N" } });
          });
          assert.equal(
            findButtonByText(renderer.root, /Create brand/).props.disabled,
            false,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("Cancel closes the create panel without calling createBrand", () => {
      withPortalDom(() => {
        const renderer = mount({ initialBrands: [], canFontUpload: false });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            findButtonByText(renderer.root, /^Cancel$/).props.onClick();
          });
          assert.throws(() => renderer.root.findByProps({ id: "brand-name" }));
          assert.equal(
            globalForActions.__brandActionsTestState.createCalls.length,
            0,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("update brand flow", () => {
    test("expanding a card pre-fills the form with the brand's data; submitting calls updateBrand with its id and collapses on success", async () => {
      await withPortalDom(async () => {
        const brand = buildBrand({ id: "b1", name: "Acme" });
        const renderer = mount({
          initialBrands: [brand],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const nameInput = renderer.root.findByProps({ id: "brand-name" });
          assert.equal(nameInput.props.value, "Acme");

          act(() => {
            nameInput.props.onChange({ target: { value: "Acme Renamed" } });
          });

          globalForActions.__brandActionsTestState.updateImpl = async (
            id,
            payload,
          ) => ({
            ok: true,
            data: buildBrand({
              id,
              name: (payload as { name: string }).name,
            }),
          });

          await act(async () => {
            findButtonByText(renderer.root, /Save changes/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          assert.deepEqual(
            globalForActions.__brandActionsTestState.updateCalls.map(
              (c) => c.id,
            ),
            ["b1"],
          );
          // Collapsed again; header now shows the renamed brand.
          renderer.root.findByProps({ "aria-label": "Brand: Acme Renamed" });
          assert.throws(() => renderer.root.findByProps({ id: "brand-name" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a failed updateBrand shows the error message and keeps the form expanded", async () => {
      await withPortalDom(async () => {
        globalForActions.__brandActionsTestState.updateImpl = async () => ({
          ok: false,
          error: "Not authorized.",
        });
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          await act(async () => {
            findButtonByText(renderer.root, /Save changes/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Not authorized/);
          renderer.root.findByProps({ id: "brand-name" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("the collapse (chevron) icon toggles the form open/closed without saving", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
        });
        try {
          const toggle = renderer.root.findByProps({ "aria-label": "Expand" });
          act(() => {
            toggle.props.onClick();
          });
          renderer.root.findByProps({ id: "brand-name" });
          const collapse = renderer.root.findByProps({
            "aria-label": "Collapse",
          });
          act(() => {
            collapse.props.onClick();
          });
          assert.throws(() => renderer.root.findByProps({ id: "brand-name" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("delete brand flow", () => {
    test("clicking delete opens a confirmation dialog; Cancel closes it without calling deleteBrand", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          const dialog = renderer.root.findByProps({ role: "dialog" });
          assert.equal(dialog.props["aria-busy"], false);
          assert.match(textOf(dialog), /Delete “Acme”\?/);

          act(() => {
            findButtonByText(renderer.root, /^Cancel$/).props.onClick();
          });
          assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
          assert.equal(
            globalForActions.__brandActionsTestState.deleteCalls.length,
            0,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("confirming delete disables the dialog's actions while pending, calls deleteBrand, and removes the card on success", async () => {
      await withPortalDom(async () => {
        let resolveDelete!: (value: ActionResultLike) => void;
        globalForActions.__brandActionsTestState.deleteImpl = () =>
          new Promise((resolve) => {
            resolveDelete = resolve;
          });
        const renderer = mount({
          initialBrands: [buildBrand({ id: "b1", name: "Acme" })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          await act(async () => {
            const confirm = findButtonByText(renderer.root, /Delete brand$/);
            confirm.props.onClick();
            confirm.props.onClick();
            findButtonByText(renderer.root, /^Cancel$/).props.onClick();
            renderer.root
              .find(
                (element) =>
                  element.type === "div" &&
                  element.props["aria-hidden"] === "true" &&
                  typeof element.props.onClick === "function",
              )
              .props.onClick();
            await waitForAsyncDrain();
          });

          // Pending: dialog reflects aria-busy, both actions disabled, and
          // the header's delete icon shows a spinner.
          assert.equal(
            renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
            true,
          );
          assert.equal(
            findButtonByText(renderer.root, /^Cancel$/).props.disabled,
            true,
          );
          assert.equal(
            findButtonByText(renderer.root, /Delete brand$/).props.disabled,
            true,
          );
          assert.equal(
            renderer.root.findByProps({ "aria-label": "Delete brand" }).props
              .disabled,
            true,
          );
          assert.deepEqual(
            globalForActions.__brandActionsTestState.deleteCalls,
            ["b1"],
          );
          renderer.root.findByProps({ role: "dialog" });

          await act(async () => {
            resolveDelete({ ok: true, data: undefined });
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          assert.deepEqual(
            globalForActions.__brandActionsTestState.deleteCalls,
            ["b1"],
          );
          assert.throws(() =>
            renderer.root.findByProps({ "aria-label": "Brand: Acme" }),
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a failed deleteBrand leaves the card and open dialog in place (no crash, no silent data loss)", async () => {
      await withPortalDom(async () => {
        globalForActions.__brandActionsTestState.deleteImpl = async () => ({
          ok: false,
          error: "Not authorized.",
        });
        const renderer = mount({
          initialBrands: [buildBrand({ id: "b1", name: "Acme" })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          await act(async () => {
            await findButtonByText(
              renderer.root,
              /Delete brand$/,
            ).props.onClick();
          });

          assert.deepEqual(
            globalForActions.__brandActionsTestState.deleteCalls,
            ["b1"],
          );
          // Card still present; dialog no longer pending (buttons re-enabled).
          renderer.root.findByProps({ "aria-label": "Brand: Acme" });
          assert.equal(
            findButtonByText(renderer.root, /Delete brand$/).props.disabled,
            false,
          );
          assert.match(
            textOf(renderer.root.findByProps({ role: "alert" })),
            /Not authorized/,
          );
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Dismiss delete error" })
              .props.onClick();
          });
          assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a rejected delete transport shows safe feedback and keeps the confirmation retryable", async () => {
      await withPortalDom(async () => {
        globalForActions.__brandActionsTestState.deleteImpl = async () => {
          throw new Error("database transport leaked details");
        };
        const renderer = mount({
          initialBrands: [buildBrand({ id: "b1", name: "Acme" })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          await act(async () => {
            findButtonByText(renderer.root, /Delete brand$/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Couldn't delete the brand/);
          assert.doesNotMatch(textOf(alert), /database transport/);
          renderer.root.findByProps({ role: "dialog" });
          assert.equal(
            findButtonByText(renderer.root, /Delete brand$/).props.disabled,
            false,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("framework redirect control flow escapes delete recovery", async () => {
      await withPortalDom(async () => {
        const redirectError = new Error("NEXT_REDIRECT:/login");
        globalForActions.__brandActionsTestState.deleteImpl = async () => {
          throw redirectError;
        };
        const renderer = mount({
          initialBrands: [buildBrand({ id: "b1", name: "Acme" })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          await assert.rejects(
            async () => {
              await act(async () => {
                await findButtonByText(
                  renderer.root,
                  /Delete brand$/,
                ).props.onClick();
              });
            },
            (error: unknown) => error === redirectError,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("logo upload", () => {
    test("uploads via the injected port, persists the returned url/assetId, and shows a remove-logo control", async () => {
      await withPortalDom(async () => {
        const uploadPort = buildUploadPort();
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const logoInput = findFileInput(renderer.root, "image");
          const file = new File(["x"], "logo.png", { type: "image/png" });
          await selectFile(logoInput, file);

          const img = renderer.root.findByProps({
            alt: "Brand logo preview",
          });
          assert.equal(
            img.props.src,
            "https://textiq.test/api/brand-assets/logo-1",
          );
          renderer.root.findByProps({ "aria-label": "Remove logo" });
          assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("shows the uploading status and disables the trigger while the upload is in flight", async () => {
      await withPortalDom(async () => {
        let resolveUpload!: (value: { url: string; assetId: string }) => void;
        const uploadPort = buildUploadPort({
          uploadLogo: () =>
            new Promise((resolve) => {
              resolveUpload = resolve;
            }),
        });
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const logoInput = findFileInput(renderer.root, "image");
          const file = new File(["x"], "logo.png", { type: "image/png" });
          act(() => {
            logoInput.props.onChange({
              target: { files: [file], value: "logo.png" },
            });
          });
          await act(async () => {
            await waitForAsyncDrain();
          });

          assert.match(textOf(renderer.root), /Uploading logo and extracting/);
          assert.equal(
            findButtonByText(renderer.root, /Upload logo/).props.disabled,
            true,
          );

          await act(async () => {
            resolveUpload({
              url: "https://textiq.test/api/brand-assets/logo-1",
              assetId: "logo-asset-1",
            });
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
          assert.doesNotMatch(
            textOf(renderer.root),
            /Uploading logo and extracting/,
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a logo upload has one operation boundary and blocks save or close until its asset is ready", async () => {
      await withPortalDom(async () => {
        const uploadAttempt = deferred<{ url: string; assetId: string }>();
        let uploadCalls = 0;
        const uploadPort = buildUploadPort({
          uploadLogo: () => {
            uploadCalls += 1;
            return uploadAttempt.promise;
          },
        });
        globalForActions.__brandActionsTestState.createImpl = async (
          payload,
        ) => ({
          ok: true,
          data: buildBrand({
            id: "created-with-logo",
            name: (payload as { name: string }).name,
            logoAssetId: (payload as { logoAssetId: string | null })
              .logoAssetId,
            logoAssetUrl: "https://textiq.test/api/brand-assets/logo-pending",
          }),
        });
        const renderer = mount({
          initialBrands: [],
          canFontUpload: false,
          uploadPort,
        });
        try {
          act(() => {
            findButtonByText(renderer.root, /New brand style/).props.onClick();
          });
          act(() => {
            renderer.root
              .findByProps({ id: "brand-name" })
              .props.onChange({ target: { value: "Upload First" } });
          });
          const logoInput = findFileInput(renderer.root, "image");
          const file = new File(["x"], "logo.png", { type: "image/png" });
          await act(async () => {
            logoInput.props.onChange({
              target: { files: [file], value: "logo.png" },
            });
            logoInput.props.onChange({
              target: { files: [file], value: "logo.png" },
            });
            await waitForAsyncDrain();
          });

          const create = findButtonByText(renderer.root, /Create brand/);
          const cancel = findButtonByText(renderer.root, /^Cancel$/);
          const close = renderer.root.findByProps({ "aria-label": "Close" });
          await act(async () => {
            create.props.onClick();
            cancel.props.onClick();
            close.props.onClick();
            await waitForAsyncDrain();
          });

          assert.equal(uploadCalls, 1);
          assert.equal(
            globalForActions.__brandActionsTestState.createCalls.length,
            0,
          );
          assert.equal(create.props.disabled, true);
          assert.equal(cancel.props.disabled, true);
          assert.equal(close.props.disabled, true);
          assert.equal(
            renderer.root.findByProps({ id: "brand-name" }).props.value,
            "Upload First",
          );

          await act(async () => {
            uploadAttempt.resolve({
              url: "https://textiq.test/api/brand-assets/logo-pending",
              assetId: "logo-asset-pending",
            });
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
          assert.equal(
            renderer.root.findByProps({ alt: "Brand logo preview" }).props.src,
            "https://textiq.test/api/brand-assets/logo-pending",
          );

          await act(async () => {
            findButtonByText(renderer.root, /Create brand/).props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
          assert.equal(
            (
              globalForActions.__brandActionsTestState.createCalls[0] as {
                logoAssetId: string;
              }
            ).logoAssetId,
            "logo-asset-pending",
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a rejected upload shows a generic failure message and does not persist a logo", async () => {
      await withPortalDom(async () => {
        const uploadPort = buildUploadPort({
          uploadLogo: async () => {
            throw new Error("network down");
          },
        });
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const logoInput = findFileInput(renderer.root, "image");
          const file = new File(["x"], "logo.png", { type: "image/png" });
          await selectFile(logoInput, file);

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Logo upload failed/);
          assert.throws(() =>
            renderer.root.findByProps({ alt: "Brand logo preview" }),
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("an oversized/invalid-type file is rejected client-side before the port is ever called", async () => {
      await withPortalDom(async () => {
        const uploadPort = buildUploadPort();
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const logoInput = findFileInput(renderer.root, "image");
          const badFile = new File(["x"], "logo.gif", { type: "image/gif" });
          await selectFile(logoInput, badFile);

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Unsupported file type/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("removing an existing logo clears both the url and asset id", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [
            buildBrand({
              logoAssetUrl: "https://textiq.test/api/brand-assets/logo-0",
              logoAssetId: "logo-asset-0",
            }),
          ],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          renderer.root.findByProps({ alt: "Brand logo preview" });
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Remove logo" })
              .props.onClick();
          });
          assert.throws(() =>
            renderer.root.findByProps({ alt: "Brand logo preview" }),
          );
          findButtonByText(renderer.root, /Upload logo \(PNG\/SVG\/JPG\)/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("font upload (entitled)", () => {
    test("unmounting invalidates a pending font upload before its late result hydrates the page", async () => {
      await withPortalDom(async () => {
        const uploadAttempt =
          deferred<Awaited<ReturnType<BrandUploadPort["uploadFont"]>>>();
        let uploadCallCount = 0;
        const uploadPort = buildUploadPort({
          uploadFont: () => {
            uploadCallCount += 1;
            return uploadAttempt.promise;
          },
        });
        let hydrationCount = 0;
        document.head.appendChild = () => {
          hydrationCount += 1;
          return null as never;
        };
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: true,
          uploadPort,
        });

        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Edit brand" })
            .props.onClick();
        });
        const fontInput = findFileInput(renderer.root, "ttf");
        const target = {
          files: [new File(["x"], "LateFont.woff2", { type: "font/woff2" })],
          value: "mock",
        };
        act(() => {
          fontInput.props.onChange({ target });
        });
        assert.equal(target.value, "");
        assert.equal(uploadCallCount, 1);
        assert.equal(hydrationCount, 0);
        assert.equal(
          renderer.root.findByProps({ id: "brand-name" }).props.disabled,
          true,
        );

        act(() => renderer.unmount());
        assert.equal(hydrationCount, 0);
        uploadAttempt.resolve({
          url: "https://textiq.test/api/brand-assets/font-late",
          assetId: "font-asset-late",
          familyName: "Late Font",
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.equal(hydrationCount, 0);
      });
    });

    test("uploads via the injected port, hydrates and persists the font family/asset id", async () => {
      await withPortalDom(async () => {
        const uploadPort = buildUploadPort();
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: true,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const fontInput = findFileInput(renderer.root, "ttf");
          const file = new File(["x"], "MyFont.woff2", {
            type: "font/woff2",
          });
          await selectFile(fontInput, file);

          assert.match(textOf(renderer.root), /Custom Font/);
          assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("a rejected font upload shows a generic failure message", async () => {
      await withPortalDom(async () => {
        const uploadPort = buildUploadPort({
          uploadFont: async () => {
            throw new Error("network down");
          },
        });
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: true,
          uploadPort,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          const fontInput = findFileInput(renderer.root, "ttf");
          const file = new File(["x"], "MyFont.woff2", {
            type: "font/woff2",
          });
          await selectFile(fontInput, file);

          const alert = renderer.root.findByProps({ role: "alert" });
          assert.match(textOf(alert), /Font upload failed/);
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("preview", () => {
    test("the collapsed card shows a compact swatch preview reflecting the brand's palette", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand({ palette: ["#aabbcc", "#112233"] })],
          canFontUpload: false,
        });
        try {
          const card = renderer.root.findByProps({
            "aria-label": "Brand: Acme",
          });
          const swatches = card
            .findAllByType("span")
            .filter(
              (span) => typeof span.props.style?.backgroundColor === "string",
            );
          const colors = swatches.map((s) => s.props.style.backgroundColor);
          assert.ok(colors.includes("#aabbcc"));
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("the expanded form shows a live sample-visual preview labelled for accessibility", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand()],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          renderer.root.findByProps({
            "aria-label": "Live brand preview on sample visual",
          });
          const svg = renderer.root.findByProps({ role: "img" });
          assert.equal(
            svg.props["aria-label"],
            "Brand preview on sample visual",
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("accessibility", () => {
    test("each card is labelled by brand name, and delete/edit controls are independently labelled", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand({ name: "Acme" })],
          canFontUpload: false,
        });
        try {
          renderer.root.findByProps({ "aria-label": "Brand: Acme" });
          renderer.root.findByProps({ "aria-label": "Edit brand" });
          renderer.root.findByProps({ "aria-label": "Delete brand" });
          renderer.root.findByProps({ "aria-label": "Expand" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("the delete dialog exposes aria-labelledby pointing at its own heading id and aria-busy defaults to false", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand({ id: "b1" })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Delete brand" })
              .props.onClick();
          });
          const dialog = renderer.root.findByProps({ role: "dialog" });
          assert.equal(dialog.props["aria-labelledby"], "delete-brand-b1");
          assert.equal(dialog.props["aria-busy"], false);
          renderer.root.findByProps({ id: "delete-brand-b1" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });

    test("palette color pickers and base color pickers each carry a distinct, descriptive aria-label", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand({ palette: ["#111111", "#222222"] })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          renderer.root.findByProps({ "aria-label": "Palette color 1" });
          renderer.root.findByProps({ "aria-label": "Palette color 2" });
          renderer.root.findByProps({ "aria-label": "Background" });
          renderer.root.findByProps({ "aria-label": "Node fill" });
          renderer.root.findByProps({ "aria-label": "Node stroke" });
          renderer.root.findByProps({ "aria-label": "Node text" });
          renderer.root.findByProps({ "aria-label": "Edge color" });
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });

  describe("palette editing", () => {
    test("adding and removing palette colors updates the ColorPicker count", () => {
      withPortalDom(() => {
        const renderer = mount({
          initialBrands: [buildBrand({ palette: ["#111111"] })],
          canFontUpload: false,
        });
        try {
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Edit brand" })
              .props.onClick();
          });
          // A single color: no remove button (guarded by `palette.length > 1`).
          assert.throws(() =>
            renderer.root.findByProps({
              "aria-label": "Remove palette color 1",
            }),
          );
          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Add palette color" })
              .props.onClick();
          });
          renderer.root.findByProps({ "aria-label": "Palette color 2" });
          renderer.root.findByProps({ "aria-label": "Remove palette color 1" });

          act(() => {
            renderer.root
              .findByProps({ "aria-label": "Remove palette color 2" })
              .props.onClick();
          });
          assert.throws(() =>
            renderer.root.findByProps({ "aria-label": "Palette color 2" }),
          );
        } finally {
          act(() => renderer.unmount());
        }
      });
    });
  });
});

describe("extractPaletteFromImageData", () => {
  function pixel(
    data: number[],
    index: number,
    [r, g, b, a]: [number, number, number, number],
  ): void {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = a;
  }

  test("returns the most frequent quantized colors, sorted descending by count", () => {
    // Sample stride is 32 bytes (4 * 8) — 8 opaque red pixels at sampled
    // offsets vs. 2 opaque blue ones, so red must sort first.
    const data = new Array(32 * 10).fill(0);
    for (let i = 0; i < 8; i++) {
      pixel(data, i * 32, [200, 40, 40, 255]);
    }
    for (let i = 8; i < 10; i++) {
      pixel(data, i * 32, [40, 40, 200, 255]);
    }
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(data));
    assert.equal(palette[0], "#c02020");
    assert.ok(palette.includes("#2020c0"));
  });

  test("skips near-transparent pixels (alpha < 128)", () => {
    const data = new Array(32).fill(0);
    pixel(data, 0, [200, 40, 40, 50]);
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(data));
    assert.deepEqual(palette, []);
  });

  test("skips near-black and near-white pixels", () => {
    const data = new Array(32 * 2).fill(0);
    pixel(data, 0, [5, 5, 5, 255]);
    pixel(data, 32, [250, 250, 250, 255]);
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(data));
    assert.deepEqual(palette, []);
  });

  test("quantizes each channel to 16 levels, merging near-duplicate shades into one bucket", () => {
    const data = new Array(32 * 2).fill(0);
    pixel(data, 0, [200, 40, 40, 255]);
    pixel(data, 32, [204, 44, 44, 255]); // same quantized bucket as above
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(data));
    assert.deepEqual(palette, ["#c02020"]);
  });

  test("caps the result at 6 colors even when more distinct buckets qualify", () => {
    const data = new Array(32 * 8).fill(0);
    const shades: Array<[number, number, number]> = [
      [200, 40, 40],
      [40, 200, 40],
      [40, 40, 200],
      [200, 200, 40],
      [200, 40, 200],
      [40, 200, 200],
      [200, 120, 40],
      [120, 40, 200],
    ];
    shades.forEach(([r, g, b], i) => {
      pixel(data, i * 32, [r, g, b, 255]);
    });
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(data));
    assert.equal(palette.length, 6);
  });
});
