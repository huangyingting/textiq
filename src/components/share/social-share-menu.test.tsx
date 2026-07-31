/**
 * Direct behavior coverage for `SocialShareMenu` (#1964) — the "Share to
 * social" trigger + dropdown (or inline menu body) offering native share,
 * copy-image-to-clipboard, and X/LinkedIn/Facebook platform intents.
 *
 * `@/lib/visual/export`'s `exportPNG` is stubbed via the shared
 * `@/test/module-stub` helper (a mutable state object hung off `globalThis`,
 * same technique as `theme-mode-button.test.tsx`'s `useThemeMode` stub) so
 * this file never rasterizes a real SVG through a canvas. `@/lib/visual/
 * export-options` (`applySocialPresetToOptions`, `DEFAULT_EXPORT_OPTIONS`)
 * and `@/lib/share/social-intents` (the intent URL builders and
 * `canWebShare`/`canCopyImageToClipboard` capability checks) are left real —
 * both are pure and already independently unit-tested — so this file only
 * asserts `SocialShareMenu`'s own orchestration: which capability gates which
 * button, what `exportPNG` is called with, and what `navigator`/`window` APIs
 * fire for each action.
 *
 * The dropdown is a plain absolutely-positioned `<div>` (not a
 * `createPortal`), so — like `user-menu.test.tsx` — this uses a custom fake
 * `window`/`document`/`navigator` built from `@/test/browser-globals` +
 * `@/test/event-target-double` rather than `@/test/portal-dom` (whose fake
 * `document.addEventListener` is a deliberate no-op, unusable for this
 * component's real click-outside listener). `ClipboardItem` isn't in
 * `browser-globals`' supported key list, so it's saved/restored manually per
 * `setupBrowser` call. Existing `share-button.test.tsx` only ever mounts
 * this component `inline` with no `getSvgElement`, so it never exercises the
 * native-share/copy-image/non-inline trigger/click-outside/`window.open`
 * surface asserted here.
 */
import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  describe,
  test,
  type TestContext,
} from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";

import { createBrowserGlobalInstaller } from "@/test/browser-globals";
import { createTrackedEventTarget } from "@/test/event-target-double";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import {
  applySocialPresetToOptions,
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
} from "@/lib/visual/export-options";
import {
  buildFacebookIntent,
  buildLinkedInIntent,
  buildTwitterIntent,
} from "@/lib/share/social-intents";
import type { SocialShareMenuProps } from "./social-share-menu";

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

// ---------------------------------------------------------------------------
// `exportPNG` stub
// ---------------------------------------------------------------------------

interface ExportState {
  calls: Array<{ svg: unknown; options: ExportOptions }>;
  impl: (svg: unknown, options: ExportOptions) => Promise<Blob | null>;
}
const globalForExport = globalThis as typeof globalThis & {
  __socialShareMenuExportState: ExportState;
};

function resetExportState(
  impl: ExportState["impl"] = async () =>
    new Blob(["fake-png-bytes"], { type: "image/png" }),
): ExportState {
  const state: ExportState = { calls: [], impl };
  globalForExport.__socialShareMenuExportState = state;
  return state;
}
resetExportState();

stubModule(
  "@/lib/visual/export",
  `module.exports = {
  exportPNG: async (svg, options) => {
    const state = globalThis.__socialShareMenuExportState;
    state.calls.push({ svg, options });
    return state.impl(svg, options);
  },
};`,
);

// Dynamically imported after the `stubModule` call above: a static import
// would resolve the whole module graph (including `@/lib/visual/export`)
// before this file's own top-level statements run.
let SocialShareMenu: typeof import("./social-share-menu").SocialShareMenu;
before(async () => {
  SocialShareMenu = (await import("./social-share-menu")).SocialShareMenu;
});

// ---------------------------------------------------------------------------
// Browser fakes: window/document/navigator + ClipboardItem
// ---------------------------------------------------------------------------

interface BrowserState {
  shareCalls: ShareData[];
  shareImpl: (data: ShareData) => Promise<void>;
  canShareResult: boolean;
  clipboardWriteCalls: unknown[][];
  clipboardWriteImpl: (items: unknown[]) => Promise<void>;
  openCalls: Array<{ url: string; label: string; features: string }>;
}

function setupBrowser(
  opts: { share?: boolean; clipboardItem?: boolean } = {},
): {
  docTarget: ReturnType<typeof createTrackedEventTarget>;
  state: BrowserState;
  restore(): void;
} {
  const installer = createBrowserGlobalInstaller([
    "window",
    "document",
    "navigator",
  ]);
  const docTarget = createTrackedEventTarget();
  const state: BrowserState = {
    shareCalls: [],
    shareImpl: async () => {},
    canShareResult: true,
    clipboardWriteCalls: [],
    clipboardWriteImpl: async () => {},
    openCalls: [],
  };

  installer.define("document", {
    addEventListener: docTarget.addEventListener,
    removeEventListener: docTarget.removeEventListener,
  });
  installer.define("window", {
    screen: { width: 1200, height: 800 },
    open: (url: string, label: string, features: string) => {
      state.openCalls.push({ url, label, features });
      return null;
    },
  });
  installer.define("navigator", {
    ...(opts.share === false
      ? {}
      : {
          share: (data: ShareData) => {
            state.shareCalls.push(data);
            return state.shareImpl(data);
          },
          canShare: () => state.canShareResult,
        }),
    clipboard: {
      write: (items: unknown[]) => {
        state.clipboardWriteCalls.push(items);
        return state.clipboardWriteImpl(items);
      },
    },
  });

  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const hadClipboardItem = "ClipboardItem" in globalRecord;
  const previousClipboardItem = globalRecord.ClipboardItem;
  if (opts.clipboardItem === false) {
    Reflect.deleteProperty(globalRecord, "ClipboardItem");
  } else {
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    globalRecord.ClipboardItem = FakeClipboardItem;
  }

  return {
    docTarget,
    state,
    restore(): void {
      installer.restore();
      if (hadClipboardItem) {
        globalRecord.ClipboardItem = previousClipboardItem;
      } else {
        Reflect.deleteProperty(globalRecord, "ClipboardItem");
      }
    },
  };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const INSIDE_TARGET = { marker: "inside" };
const OUTSIDE_TARGET = { marker: "outside" };

function mount(
  props: SocialShareMenuProps,
  browser: ReturnType<typeof setupBrowser>,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(SocialShareMenu, { ...props }), {
      createNodeMock: () => ({
        contains: (target: unknown) => target === INSIDE_TARGET,
      }),
    });
  });
  cleanup = () => {
    act(() => renderer.unmount());
    browser.restore();
  };
  return renderer;
}

function trigger(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ "aria-label": "Share to social" });
}

function toggleTrigger(renderer: ReactTestRenderer): void {
  act(() => {
    (
      trigger(renderer).props.onClick as (event: {
        stopPropagation: () => void;
      }) => void
    )({ stopPropagation: () => {} });
  });
}

function findActionButton(renderer: ReactTestRenderer, labelSubstring: string) {
  const button = renderer.root
    .findAll((el) => el.type === "button")
    .find((el) => textOf(el).includes(labelSubstring));
  assert.ok(button, `expected an action button labeled "${labelSubstring}"`);
  return button;
}

function fakeSvg(): SVGSVGElement {
  return {} as unknown as SVGSVGElement;
}

const SQUARE_OPTIONS = applySocialPresetToOptions(
  "square",
  DEFAULT_EXPORT_OPTIONS,
);

// ---------------------------------------------------------------------------
// Rendering modes
// ---------------------------------------------------------------------------

describe("SocialShareMenu — rendering modes", () => {
  test("inline=true renders the menu body directly, with no trigger button", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc", inline: true },
      browser,
    );
    assert.throws(() =>
      renderer.root.findByProps({ "aria-label": "Share to social" }),
    );
    assert.ok(findActionButton(renderer, "Share on X / Twitter"));
  });

  test("inline=false (default) renders a trigger button and no dropdown until opened", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    const button = trigger(renderer);
    assert.equal(button.props["aria-haspopup"], "true");
    assert.equal(button.props["aria-expanded"], false);
    assert.throws(() => findActionButton(renderer, "Share on X / Twitter"));
  });

  test("applies the className prop to the non-inline root wrapper", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: null, className: "custom-class" },
      browser,
    );
    const wrapper = renderer.root.find(
      (el) =>
        el.type === "div" &&
        typeof el.props.className === "string" &&
        el.props.className.includes("custom-class"),
    );
    assert.ok(wrapper);
  });
});

// ---------------------------------------------------------------------------
// Open/close + click-outside
// ---------------------------------------------------------------------------

describe("SocialShareMenu — open/close", () => {
  test("clicking the trigger opens the dropdown and sets aria-expanded", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    toggleTrigger(renderer);
    assert.equal(trigger(renderer).props["aria-expanded"], true);
    assert.ok(findActionButton(renderer, "Share on X / Twitter"));
    assert.equal(browser.docTarget.listenerCount("click"), 1);
  });

  test("clicking the trigger again closes the dropdown and removes the document listener", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    toggleTrigger(renderer);
    toggleTrigger(renderer);
    assert.equal(trigger(renderer).props["aria-expanded"], false);
    assert.equal(browser.docTarget.listenerCount("click"), 0);
  });

  test("a document click outside the menu closes it", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    toggleTrigger(renderer);

    act(() => {
      browser.docTarget.dispatchEvent({
        type: "click",
        target: OUTSIDE_TARGET,
      });
    });

    assert.equal(trigger(renderer).props["aria-expanded"], false);
    assert.equal(browser.docTarget.listenerCount("click"), 0);
  });

  test("a document click inside the menu leaves it open", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    toggleTrigger(renderer);

    act(() => {
      browser.docTarget.dispatchEvent({ type: "click", target: INSIDE_TARGET });
    });

    assert.equal(trigger(renderer).props["aria-expanded"], true);
    assert.equal(browser.docTarget.listenerCount("click"), 1);
  });

  test("unmounting while open removes the document listener (no leak)", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc" },
      browser,
    );
    toggleTrigger(renderer);
    assert.equal(browser.docTarget.listenerCount("click"), 1);

    act(() => renderer.unmount());

    assert.equal(browser.docTarget.listenerCount("click"), 0);
    cleanup = () => browser.restore();
  });
});

// ---------------------------------------------------------------------------
// Capability gating
// ---------------------------------------------------------------------------

describe("SocialShareMenu — capability gating", () => {
  test("hides both image actions when getSvgElement is omitted, but still shows platform buttons", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: "https://x.test/s/doc", inline: true },
      browser,
    );
    assert.throws(() => findActionButton(renderer, "Share via"));
    assert.throws(() => findActionButton(renderer, "Copy image"));
    assert.ok(findActionButton(renderer, "Share on X / Twitter"));
  });

  test("shows the 'enable sharing' prompt instead of platform buttons when shareUrl is absent", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: "My doc", shareUrl: null, inline: true, getSvgElement: fakeSvg },
      browser,
    );
    assert.match(
      JSON.stringify(renderer.toJSON()),
      /Enable document sharing to post to social platforms\./,
    );
    assert.throws(() => findActionButton(renderer, "Share on X / Twitter"));
    // Image actions are independent of shareUrl.
    assert.ok(findActionButton(renderer, "Share via"));
  });

  test("hides 'Share via…' when the Web Share API is unsupported (no navigator.share)", () => {
    const browser = setupBrowser({ share: false });
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );
    assert.throws(() => findActionButton(renderer, "Share via"));
    assert.ok(findActionButton(renderer, "Copy image"));
  });

  test("hides 'Copy image' when Clipboard image support is unsupported (no ClipboardItem)", () => {
    const browser = setupBrowser({ clipboardItem: false });
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );
    assert.throws(() => findActionButton(renderer, "Copy image"));
    assert.ok(findActionButton(renderer, "Share via"));
  });
});

// ---------------------------------------------------------------------------
// Copy image to clipboard
// ---------------------------------------------------------------------------

describe("SocialShareMenu — copy image to clipboard", () => {
  test("one synchronous image-operation boundary suppresses duplicate and competing actions", async () => {
    const browser = setupBrowser();
    let resolveExport!: (blob: Blob | null) => void;
    resetExportState(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const copyButton = findActionButton(renderer, "Copy image");
    const shareButton = findActionButton(renderer, "Share via");
    act(() => {
      (copyButton.props.onClick as () => void)();
      (copyButton.props.onClick as () => void)();
      (shareButton.props.onClick as () => void)();
    });

    assert.equal(globalForExport.__socialShareMenuExportState.calls.length, 1);
    assert.equal(
      renderer.root.findByProps({ "aria-busy": true }).props["aria-busy"],
      true,
    );
    assert.equal(findActionButton(renderer, "Copying").props.disabled, true);
    assert.equal(findActionButton(renderer, "Share via").props.disabled, true);
    assert.equal(browser.state.shareCalls.length, 0);

    await act(async () => {
      resolveExport(new Blob(["png"], { type: "image/png" }));
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });
    assert.equal(browser.state.clipboardWriteCalls.length, 1);

    resetExportState();
    await act(async () => {
      (findActionButton(renderer, "Share via").props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });
    assert.equal(browser.state.shareCalls.length, 1);
  });

  test("success: exports the square preset, writes a ClipboardItem, shows 'Copied!' then reverts after 2500ms", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const browser = setupBrowser();
    resetExportState();
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Copy image");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.equal(globalForExport.__socialShareMenuExportState.calls.length, 1);
    assert.deepEqual(
      globalForExport.__socialShareMenuExportState.calls[0].options,
      SQUARE_OPTIONS,
    );
    assert.equal(browser.state.clipboardWriteCalls.length, 1);
    assert.match(textOf(renderer.root), /Copied!/);

    act(() => {
      t.mock.timers.tick(2500);
    });
    assert.match(
      textOf(findActionButton(renderer, "Copy image")),
      /Copy image/,
    );
  });

  test("error: exportPNG returning null surfaces 'Copy failed', then reverts after 2500ms", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const browser = setupBrowser();
    resetExportState(async () => null);
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Copy image");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.equal(browser.state.clipboardWriteCalls.length, 0);
    assert.match(textOf(renderer.root), /Copy failed/);

    act(() => {
      t.mock.timers.tick(2500);
    });
    assert.match(
      textOf(findActionButton(renderer, "Copy image")),
      /Copy image/,
    );
  });

  test("error: navigator.clipboard.write rejecting surfaces 'Copy failed'", async () => {
    const browser = setupBrowser();
    resetExportState();
    browser.state.clipboardWriteImpl = async () => {
      throw new Error("clipboard denied");
    };
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Copy image");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.match(textOf(renderer.root), /Copy failed/);
  });
});

// ---------------------------------------------------------------------------
// Native share
// ---------------------------------------------------------------------------

describe("SocialShareMenu — native share", () => {
  test("success: exports the square preset, builds a File, and shares it via navigator.share", async () => {
    const browser = setupBrowser();
    resetExportState();
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Share via");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.equal(browser.state.shareCalls.length, 1);
    const call = browser.state.shareCalls[0] as ShareData & {
      files?: File[];
    };
    assert.equal(call.title, "My doc");
    assert.equal(call.url, "https://x.test/s/doc");
    assert.equal(call.files?.length, 1);
    assert.equal(call.files?.[0].type, "image/png");
    assert.match(textOf(renderer.root), /Share via…/);
  });

  test("falls back to link/title-only share when file sharing isn't supported (canShare returns false)", async () => {
    const browser = setupBrowser();
    browser.state.canShareResult = false;
    resetExportState();
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Share via");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.equal(browser.state.shareCalls.length, 1);
    assert.deepEqual(browser.state.shareCalls[0], {
      title: "My doc",
      url: "https://x.test/s/doc",
    });
  });

  test("an AbortError from navigator.share (user dismissed the sheet) is treated as a normal close, not an error", async () => {
    const browser = setupBrowser();
    resetExportState();
    browser.state.shareImpl = async () => {
      throw Object.assign(new Error("user aborted"), { name: "AbortError" });
    };
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Share via");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.doesNotMatch(textOf(renderer.root), /Share failed/);
    assert.match(textOf(renderer.root), /Share via…/);
  });

  test("a generic navigator.share rejection surfaces 'Share failed', then reverts after 2500ms", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const browser = setupBrowser();
    resetExportState();
    browser.state.shareImpl = async () => {
      throw new Error("boom");
    };
    const renderer = mount(
      {
        title: "My doc",
        shareUrl: "https://x.test/s/doc",
        inline: true,
        getSvgElement: fakeSvg,
      },
      browser,
    );

    const button = findActionButton(renderer, "Share via");
    await act(async () => {
      (button.props.onClick as () => void)();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.match(textOf(renderer.root), /Share failed/);

    act(() => {
      t.mock.timers.tick(2500);
    });
    assert.match(textOf(findActionButton(renderer, "Share via")), /Share via…/);
  });
});

// ---------------------------------------------------------------------------
// Platform intent URLs
// ---------------------------------------------------------------------------

describe("SocialShareMenu — platform intents", () => {
  const SHARE_URL = "https://x.test/s/doc";
  const TITLE = "My great doc";

  test("Share on X / Twitter opens a popup at the Twitter intent URL", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: TITLE, shareUrl: SHARE_URL, inline: true },
      browser,
    );
    act(() => {
      (
        findActionButton(renderer, "Share on X / Twitter").props
          .onClick as () => void
      )();
    });
    assert.deepEqual(browser.state.openCalls, [
      {
        url: buildTwitterIntent(SHARE_URL, TITLE),
        label: "share-twitter",
        features:
          "width=600,height=480,left=300,top=160,toolbar=0,menubar=0,noopener,noreferrer",
      },
    ]);
  });

  test("Share on LinkedIn opens a popup at the LinkedIn intent URL", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: TITLE, shareUrl: SHARE_URL, inline: true },
      browser,
    );
    act(() => {
      (
        findActionButton(renderer, "Share on LinkedIn").props
          .onClick as () => void
      )();
    });
    assert.deepEqual(browser.state.openCalls, [
      {
        url: buildLinkedInIntent(SHARE_URL),
        label: "share-linkedin",
        features:
          "width=600,height=480,left=300,top=160,toolbar=0,menubar=0,noopener,noreferrer",
      },
    ]);
  });

  test("Share on Facebook opens a popup at the Facebook intent URL", () => {
    const browser = setupBrowser();
    const renderer = mount(
      { title: TITLE, shareUrl: SHARE_URL, inline: true },
      browser,
    );
    act(() => {
      (
        findActionButton(renderer, "Share on Facebook").props
          .onClick as () => void
      )();
    });
    assert.deepEqual(browser.state.openCalls, [
      {
        url: buildFacebookIntent(SHARE_URL),
        label: "share-facebook",
        features:
          "width=600,height=480,left=300,top=160,toolbar=0,menubar=0,noopener,noreferrer",
      },
    ]);
  });
});
