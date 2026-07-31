/**
 * Direct behavior coverage for `ExportDialog` (#1963) — format/background/
 * color-mode/scale controls, social presets, branding toggle, live preview,
 * `handleExport`'s entitlement guards + pending/success/failure/exception
 * paths, and Escape-to-close.
 *
 * `@/lib/visual/export` (`exportPNG`/`exportPDF`/`exportPPTX`/`downloadBlob`)
 * already has its own dedicated `export.test.ts` covering the real
 * canvas/`Image`/`document.createElement` browser APIs — duplicating that
 * here would both re-test already-covered logic and require a much heavier
 * DOM shim, so the whole module is stubbed via `@/test/module-stub`'s
 * `stubModule`, with a `globalThis`-attached test-state object (the same
 * pattern `share-button.test.tsx` uses for its sibling `"./actions"` stub)
 * recording calls and letting each test control the resolved `Blob`/error.
 * `applyExportOptionsToSvg` (`@/lib/visual/export-options`) is a pure string
 * transform per its own doc comment, so the SVG/PDF preview and SVG download
 * paths run for real — Node just lacks a global `XMLSerializer`, filled in
 * with a minimal stub class (not a full DOM parse, mirroring
 * `portal-dom.ts`'s own `IntersectionObserver` polyfill precedent).
 *
 * Mounts via `@/test/portal-dom`'s `withPortalDom`/`mountWithPortalDom`
 * (`VisualExportDialogShell` renders through `AnimatePresence`/`motion.div`
 * and `createPortal(..., document.body)`), with `window.addEventListener`
 * monkey-patched to actually capture the `keydown` handler (portal-dom's own
 * default is a no-op, since no other current test needs to invoke a
 * window-level listener) so the Escape-to-close wiring can be exercised.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";

type ExportCall = { options: { scale: number; [key: string]: unknown } };
type PptxCall = { visual: unknown; options: unknown };
type DownloadCall = { filename: string; size: number; type: string };

type ExportTestState = {
  pngCalls: ExportCall[];
  pdfCalls: ExportCall[];
  pptxCalls: PptxCall[];
  downloadCalls: DownloadCall[];
  pngImpl: (options: unknown) => Promise<Blob | null>;
  pdfImpl: (options: unknown) => Promise<Blob | null>;
  pptxImpl: (visual: unknown, options: unknown) => Promise<Blob | null>;
};

const globalForExport = globalThis as typeof globalThis & {
  __exportDialogTestState: ExportTestState;
};

function resetExportState(): void {
  globalForExport.__exportDialogTestState = {
    pngCalls: [],
    pdfCalls: [],
    pptxCalls: [],
    downloadCalls: [],
    pngImpl: async () => new Blob(["png-bytes"], { type: "image/png" }),
    pdfImpl: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
    pptxImpl: async () =>
      new Blob(["pptx-bytes"], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
  };
}
resetExportState();

stubModule(
  "@/lib/visual/export",
  `module.exports = {
  exportPNG: async (svg, options) => {
    const s = globalThis.__exportDialogTestState;
    s.pngCalls.push({ options });
    return s.pngImpl(options);
  },
  exportPDF: async (svg, options) => {
    const s = globalThis.__exportDialogTestState;
    s.pdfCalls.push({ options });
    return s.pdfImpl(options);
  },
  exportPPTX: async (svg, visual, options) => {
    const s = globalThis.__exportDialogTestState;
    s.pptxCalls.push({ visual, options });
    return s.pptxImpl(visual, options);
  },
  downloadBlob: (blob, filename) => {
    const s = globalThis.__exportDialogTestState;
    s.downloadCalls.push({ filename, size: blob.size, type: blob.type });
  },
};`,
);

// Node has no global `XMLSerializer`/`DOMParser`; `export-dialog.tsx` calls
// `new XMLSerializer().serializeToString(svg)` directly (not through the
// stubbable `@/lib/visual/export` module) for its SVG/PDF preview and SVG
// download. `applyExportOptionsToSvg`/`buildTransformedSvgString` are pure
// string transforms per their own doc comments, so a fixed serialization is
// enough to exercise them for real.
class FakeXMLSerializer {
  serializeToString(): string {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#fff"/></svg>';
  }
}
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer =
  FakeXMLSerializer;

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

// Dynamically imported (in `before`, after `stubModule` above) so the static
// import graph never resolves the real `@/lib/visual/export` first.
let ExportDialog: typeof import("./export-dialog").ExportDialog;
before(async () => {
  ExportDialog = (await import("./export-dialog")).ExportDialog;
});

beforeEach(resetExportState);

function fakeSvg(): SVGSVGElement {
  return {
    viewBox: { baseVal: { width: 640, height: 360 } },
  } as unknown as SVGSVGElement;
}

function withExportDom<T>(run: () => T): T {
  return withPortalDom(() => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    (
      window as unknown as {
        addEventListener: (
          type: string,
          cb: (e: KeyboardEvent) => void,
        ) => void;
        removeEventListener: (
          type: string,
          cb: (e: KeyboardEvent) => void,
        ) => void;
        __keydownListeners: Map<string, (event: KeyboardEvent) => void>;
      }
    ).addEventListener = (type, cb) => {
      listeners.set(type, cb);
    };
    (
      window as unknown as {
        removeEventListener: (type: string, cb: unknown) => void;
      }
    ).removeEventListener = (type) => {
      listeners.delete(type);
    };
    (
      window as unknown as {
        __keydownListeners: Map<string, (event: KeyboardEvent) => void>;
      }
    ).__keydownListeners = listeners;
    return run();
  });
}

function dispatchWindowKeydown(key: string): void {
  const listeners = (
    window as unknown as {
      __keydownListeners: Map<string, (event: KeyboardEvent) => void>;
    }
  ).__keydownListeners;
  const handler = listeners.get("keydown");
  handler?.({ key } as KeyboardEvent);
}

function findRadioGroup(
  root: import("react-test-renderer").ReactTestInstance,
  ariaLabel: string,
) {
  return root.findByProps({ role: "radiogroup", "aria-label": ariaLabel });
}

function findRadio(
  root: import("react-test-renderer").ReactTestInstance,
  groupAriaLabel: string,
  optionText: string,
) {
  const group = findRadioGroup(root, groupAriaLabel);
  return group.find(
    (node) => node.type === "button" && textOf(node).includes(optionText),
  );
}

const FREE_ENTITLEMENTS = {
  svgExport: false,
  pptxExport: false,
  removeWatermark: false,
};
const PRO_ENTITLEMENTS = {
  svgExport: true,
  pptxExport: true,
  removeWatermark: true,
};

describe("ExportDialog", () => {
  test("renders nothing when closed", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open={false}
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("free tier: defaults to PNG format, hides the branding toggle, shows the watermark upsell, and blocks switching to SVG/PPTX", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
          entitlements={FREE_ENTITLEMENTS}
        />,
      );
      try {
        const dialog = renderer.root.findByProps({ role: "dialog" });
        assert.equal(dialog.props["aria-label"], "Export visual");
        assert.match(
          textOf(renderer.root),
          /Free plan: exports include a watermark/,
        );
        assert.throws(() =>
          renderer.root.findByProps({
            "aria-label": "Include TextIQ branding",
          }),
        );

        // The SegmentedControl's own `onChange` guards `svg`/`pptx` when not
        // entitled (`if (f === "svg" && !canSvg) return;`), so clicking it
        // never actually flips `format` — the inline "requires Plus or Pro"
        // hint only ever renders if `format` is already svg/pptx *while*
        // unentitled (e.g. a downgrade mid-session, covered separately below).
        act(() => {
          (
            findRadio(renderer.root, "Export format", "SVG").props
              .onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /Download PNG/);
        assert.equal(
          findRadio(renderer.root, "Export format", "SVG").props[
            "aria-checked"
          ],
          false,
        );
        assert.doesNotMatch(
          textOf(renderer.root),
          /SVG export requires Plus or Pro/,
        );

        act(() => {
          (
            findRadio(renderer.root, "Export format", "PPTX").props
              .onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /Download PNG/);
        assert.equal(
          findRadio(renderer.root, "Export format", "PPTX").props[
            "aria-checked"
          ],
          false,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("switching to PPTX hides social/background/color/resolution controls and shows the native-shapes hint; switching to PDF keeps raster controls", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
          entitlements={PRO_ENTITLEMENTS}
        />,
      );
      try {
        act(() => {
          (
            findRadio(renderer.root, "Export format", "PPTX").props
              .onClick as () => void
          )();
        });
        assert.throws(() => findRadioGroup(renderer.root, "Background mode"));
        assert.throws(() => findRadioGroup(renderer.root, "Color mode"));
        assert.throws(() => findRadioGroup(renderer.root, "Export resolution"));
        assert.match(
          textOf(renderer.root),
          /Native PPTX exports are editable shapes/,
        );

        act(() => {
          (
            findRadio(renderer.root, "Export format", "PDF").props
              .onClick as () => void
          )();
        });
        assert.ok(findRadioGroup(renderer.root, "Background mode"));
        assert.ok(findRadioGroup(renderer.root, "Color mode"));
        assert.ok(findRadioGroup(renderer.root, "Export resolution"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("selecting a social preset applies it (background reflects the preset); clicking it again clears it", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      // The button list re-renders (a fresh host fiber per commit) each time
      // `options.socialPreset` changes, so instances found before an `act()`
      // must be re-queried afterward rather than reused — reusing a stale
      // `ReactTestInstance` here throws "Unable to find node on an unmounted
      // component" once React discards the prior commit's fiber.
      const findPreset = () =>
        renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Square 1:1"),
        );
      try {
        act(() => {
          (findPreset().props.onClick as () => void)();
        });
        assert.equal(findPreset().props["aria-pressed"], true);
        assert.match(textOf(renderer.root), /Click again to clear preset\./);

        act(() => {
          (findPreset().props.onClick as () => void)();
        });
        assert.equal(findPreset().props["aria-pressed"], false);
        assert.doesNotMatch(
          textOf(renderer.root),
          /Click again to clear preset\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("background: choosing Custom reveals a color field wired to setCustomBackground", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        assert.throws(() =>
          renderer.root.findByProps({
            "aria-label": "Custom background color",
          }),
        );
        act(() => {
          (
            findRadio(renderer.root, "Background mode", "Custom").props
              .onClick as () => void
          )();
        });
        const colorField = renderer.root.findByProps({
          "aria-label": "Custom background color",
        });
        act(() => {
          (colorField.props.onChange as (hex: string) => void)("#112233");
        });
        assert.match(textOf(renderer.root), /#112233/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("resolution: switching scale updates the displayed export dimensions", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        assert.match(textOf(renderer.root), /1280 × 720 px/);
        act(() => {
          (
            findRadio(renderer.root, "Export resolution", "3×").props
              .onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /1920 × 1080 px/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("branding toggle is only shown for entitled plans and flips the checkbox state", () => {
    withExportDom(() => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
          entitlements={PRO_ENTITLEMENTS}
        />,
      );
      try {
        const toggle = renderer.root.findByProps({
          "aria-label": "Include TextIQ branding",
        });
        assert.equal(toggle.props.checked, false);
        act(() => {
          (toggle.props.onChange as () => void)();
        });
        const toggled = renderer.root.findByProps({
          "aria-label": "Include TextIQ branding",
        });
        assert.equal(toggled.props.checked, true);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("PNG export: downloads via the stubbed exportPNG with the scale suffix, and closes the dialog on success", async () => {
    await withExportDom(async () => {
      let closed = 0;
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {
            closed += 1;
          }}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PNG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const state = globalForExport.__exportDialogTestState;
        // `useExportPreview` also calls the stubbed `exportPNG` once on mount
        // (format defaults to "png", so the live thumbnail uses a 1x preview
        // render) in addition to the real `handleExport` call triggered by
        // the click below — hence 2 calls, not 1.
        assert.equal(state.pngCalls.length, 2);
        assert.equal(state.pngCalls[0].options.scale, 1);
        assert.equal(state.pngCalls[1].options.scale, 2);
        assert.equal(state.downloadCalls.length, 1);
        assert.equal(state.downloadCalls[0].filename, "chart@2x.png");
        assert.equal(closed, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("PNG export: shows a pending state (disabled button, 'Exporting…') until the export resolves", async () => {
    await withExportDom(async () => {
      let resolveExport!: (blob: Blob | null) => void;
      let closed = 0;
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {
            closed += 1;
          }}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        globalForExport.__exportDialogTestState.pngImpl = () =>
          new Promise((resolve) => {
            resolveExport = resolve;
          });
        let downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PNG"),
        );
        act(() => {
          (downloadButton.props.onClick as () => void)();
          (downloadButton.props.onClick as () => void)();
        });
        downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Exporting…"),
        );
        assert.equal(downloadButton.props.disabled, true);
        assert.equal(
          renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
          true,
        );
        assert.equal(
          globalForExport.__exportDialogTestState.pngCalls.length,
          2,
          "one preview plus one guarded export",
        );

        const cancel = renderer.root.find(
          (node) => node.type === "button" && textOf(node).trim() === "Cancel",
        );
        assert.equal(cancel.props.disabled, true);
        act(() => {
          (cancel.props.onClick as () => void)();
          dispatchWindowKeydown("Escape");
          (
            renderer.root.findByProps({
              "aria-label": "Close export dialog",
            }).props.onClick as () => void
          )();
        });
        assert.equal(closed, 0);

        await act(async () => {
          resolveExport(new Blob(["png-bytes"], { type: "image/png" }));
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /Download PNG/);
        assert.equal(closed, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("PNG export: a null blob surfaces 'PNG export failed' without closing", async () => {
    await withExportDom(async () => {
      let closed = 0;
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {
            closed += 1;
          }}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        globalForExport.__exportDialogTestState.pngImpl = async () => null;
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PNG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /PNG export failed/);
        assert.equal(closed, 0);
        act(() => {
          (
            renderer.root.findByProps({
              "aria-label": "Dismiss export error",
            }).props.onClick as () => void
          )();
        });
        assert.doesNotMatch(textOf(renderer.root), /PNG export failed/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("PNG export: a thrown exception surfaces 'PNG export failed' without closing", async () => {
    await withExportDom(async () => {
      let closed = 0;
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {
            closed += 1;
          }}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        globalForExport.__exportDialogTestState.pngImpl = async () => {
          throw new Error("boom");
        };
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PNG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /PNG export failed/);
        assert.equal(closed, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("export: 'No visual to export' when getSvgElement returns null", async () => {
    await withExportDom(async () => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={() => null}
          filename="chart"
        />,
      );
      try {
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PNG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /No visual to export/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("SVG export (entitled): serializes via XMLSerializer + applyExportOptionsToSvg and downloads a .svg with no scale suffix", async () => {
    await withExportDom(async () => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
          entitlements={PRO_ENTITLEMENTS}
        />,
      );
      try {
        act(() => {
          (
            findRadio(renderer.root, "Export format", "SVG").props
              .onClick as () => void
          )();
        });
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download SVG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
        });
        const state = globalForExport.__exportDialogTestState;
        assert.equal(state.downloadCalls.length, 1);
        assert.equal(state.downloadCalls[0].filename, "chart.svg");
        assert.equal(
          state.downloadCalls[0].type,
          "image/svg+xml;charset=utf-8",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("SVG export is blocked by the handleExport entitlement guard even if format is already 'svg' when entitlements are revoked (e.g. a downgrade mid-session)", async () => {
    await withExportDom(async () => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
          entitlements={PRO_ENTITLEMENTS}
        />,
      );
      try {
        act(() => {
          (
            findRadio(renderer.root, "Export format", "SVG").props
              .onClick as () => void
          )();
        });
        act(() => {
          renderer.update(
            <ExportDialog
              open
              onClose={() => {}}
              getSvgElement={fakeSvg}
              filename="chart"
              entitlements={FREE_ENTITLEMENTS}
            />,
          );
        });
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download SVG"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
        });
        assert.match(
          textOf(renderer.root),
          /SVG export requires Plus or Pro\. Upgrade your plan\./,
        );
        assert.equal(
          globalForExport.__exportDialogTestState.downloadCalls.length,
          0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("PPTX export (entitled): calls exportPPTX with the provided getVisual() result", async () => {
    await withExportDom(async () => {
      const visual = { title: "Deck" };
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          getVisual={() => visual as never}
          filename="deck"
          entitlements={PRO_ENTITLEMENTS}
        />,
      );
      try {
        act(() => {
          (
            findRadio(renderer.root, "Export format", "PPTX").props
              .onClick as () => void
          )();
        });
        const downloadButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Download PPTX"),
        );
        await act(async () => {
          (downloadButton.props.onClick as () => void)();
          await waitForAsyncDrain();
        });
        const state = globalForExport.__exportDialogTestState;
        assert.equal(state.pptxCalls.length, 1);
        assert.equal(state.pptxCalls[0].visual, visual);
        assert.equal(state.downloadCalls[0].filename, "deck.pptx");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Cancel and the Escape key both call onClose", () => {
    withExportDom(() => {
      let closed = 0;
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {
            closed += 1;
          }}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        const cancel = renderer.root.find(
          (node) => node.type === "button" && textOf(node).trim() === "Cancel",
        );
        act(() => {
          (cancel.props.onClick as () => void)();
        });
        assert.equal(closed, 1);

        dispatchWindowKeydown("Escape");
        assert.equal(closed, 2);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the live preview thumbnail eventually shows an <img> once the PNG preview resolves", async () => {
    await withExportDom(async () => {
      const renderer = mountWithPortalDom(
        <ExportDialog
          open
          onClose={() => {}}
          getSvgElement={fakeSvg}
          filename="chart"
        />,
      );
      try {
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const img = renderer.root.findByType("img");
        assert.equal(img.props.alt, "Export preview");
        assert.ok(
          typeof img.props.src === "string" && img.props.src.length > 0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
