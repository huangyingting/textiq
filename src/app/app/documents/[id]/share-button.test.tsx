/**
 * Direct behavior coverage for `ShareButton` (#1961) — the document header's
 * share popover: private/public toggle, link copy, regenerate, expiry,
 * passcode, embed/present access + copy, social-preview metadata/discoverable
 * settings, and the inline `SocialShareMenu` presence gating.
 *
 * `toggleDocumentSharing`/`regenerateShareLink`/`updateSharePolicy`
 * (`./actions` → `./sharing-actions`) are already fully covered by
 * `sharing-actions.test.ts`/`sharing-actions-coverage.test.ts`, so `"./actions"`
 * is stubbed via the shared `@/test/module-stub` helper — this file only
 * asserts *which* action `ShareButton` calls, with what arguments, and how it
 * renders the resulting `ShareSettings` (or a surfaced error).
 *
 * Uses `@/test/portal-dom`'s `withPortalDom`/`mountWithPortalDom`: `Popover`
 * measures its trigger via `getBoundingClientRect`/`closest`/`offsetWidth`
 * (a `useLayoutEffect` that fires on open) and `EditorToolbarButton` renders a
 * `Tooltip` — both need the fake portal DOM's ref mocks. `window.location` is
 * added per-test (the shared fake `window` has none) since `shareUrlFor`
 * reads `window.location.origin`, and `navigator.clipboard` is stubbed for
 * `copyLink`/`copyEmbed`/`copyPresentLink`.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { ShareSettings } from "@/lib/document/persistence-types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ActionsTestState = {
  toggleCalls: Array<{ id: string; isShared: boolean }>;
  regenerateCalls: string[];
  policyCalls: Array<{ id: string; policy: Record<string, unknown> }>;
  toggleImpl: (
    id: string,
    isShared: boolean,
  ) => Promise<ActionResult<ShareSettings>>;
  regenerateImpl: (id: string) => Promise<ActionResult<ShareSettings>>;
  policyImpl: (
    id: string,
    policy: Record<string, unknown>,
  ) => Promise<ActionResult<ShareSettings>>;
};
const globalForActions = globalThis as typeof globalThis & {
  __shareButtonActionsTestState: ActionsTestState;
};

const BASE_SETTINGS: ShareSettings = {
  isShared: false,
  shareId: null,
  slug: null,
  shareUrl: null,
  expiresAt: null,
  embedEnabled: true,
  presentEnabled: true,
  metadataMode: "generic",
  discoverable: false,
  passcodeEnabled: false,
};

const SHARED_SETTINGS: ShareSettings = {
  ...BASE_SETTINGS,
  isShared: true,
  shareId: "share123",
  slug: "quarterly-plan",
  shareUrl: null, // ShareButton derives its own URL; this field is ignored.
};

function resetActionsState(): void {
  globalForActions.__shareButtonActionsTestState = {
    toggleCalls: [],
    regenerateCalls: [],
    policyCalls: [],
    toggleImpl: async () => ({ ok: true, data: SHARED_SETTINGS }),
    regenerateImpl: async () => ({ ok: true, data: SHARED_SETTINGS }),
    policyImpl: async (_id, policy) => ({
      ok: true,
      data: { ...SHARED_SETTINGS, ...policy } as unknown as ShareSettings,
    }),
  };
}
resetActionsState();

stubModule(
  "./actions",
  `module.exports = {
  toggleDocumentSharing: async (id, isShared) => {
    const s = globalThis.__shareButtonActionsTestState;
    s.toggleCalls.push({ id, isShared });
    return s.toggleImpl(id, isShared);
  },
  regenerateShareLink: async (id) => {
    const s = globalThis.__shareButtonActionsTestState;
    s.regenerateCalls.push(id);
    return s.regenerateImpl(id);
  },
  updateSharePolicy: async (id, policy) => {
    const s = globalThis.__shareButtonActionsTestState;
    s.policyCalls.push({ id, policy });
    return s.policyImpl(id, policy);
  },
};`,
);

stubModule(
  "next/navigation",
  `module.exports = {
  unstable_rethrow(error) {
    if (error instanceof Error && error.message.startsWith("NEXT_")) {
      throw error;
    }
  },
};`,
);

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

// Dynamically imported (in `before`, after the `stubModule` call above)
// rather than statically at the top of this file: static imports of a whole
// dependency subtree resolve *before* any of this file's own top-level
// statements run, which would load the real `"use server"` `"./actions"`
// instead of the stub.
let ShareButton: typeof import("./share-button").ShareButton;
let resolveShareMutation: typeof import("./share-button").resolveShareMutation;
before(async () => {
  const shareButtonModule = await import("./share-button");
  ShareButton = shareButtonModule.ShareButton;
  resolveShareMutation = shareButtonModule.resolveShareMutation;
});

beforeEach(resetActionsState);

function installClipboard(): { writeText: (text: string) => Promise<void> } & {
  calls: string[];
} {
  const calls: string[] = [];
  const clipboard = {
    calls,
    writeText: async (text: string) => {
      calls.push(text);
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard },
  });
  return clipboard;
}

function withShareDom<T>(run: () => T | Promise<T>): T | Promise<T> {
  return withPortalDom(() => {
    (window as unknown as { location: { origin: string } }).location = {
      origin: "https://textiq.test",
    };
    const previousNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    installClipboard();
    const result = run();
    const restore = () => {
      if (previousNavigator) {
        Object.defineProperty(globalThis, "navigator", previousNavigator);
      } else {
        Reflect.deleteProperty(globalThis, "navigator");
      }
    };
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          restore();
          return value;
        },
        (error: unknown) => {
          restore();
          throw error;
        },
      ) as T;
    }
    restore();
    return result;
  });
}

function findByAria(
  root: import("react-test-renderer").ReactTestInstance,
  label: string,
) {
  return root.find(
    (node) =>
      node.props["aria-label"] === label && typeof node.type === "string",
  );
}

describe("ShareButton", () => {
  test("renders only the trigger button when closed; opening shows Private + the disabled social prompt", async () => {
    await withShareDom(async () => {
      (window as unknown as { innerHeight: number }).innerHeight = 720;
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared={false}
          initialShareId={null}
        />,
      );
      try {
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));

        const trigger = findByAria(renderer.root, "Share");
        act(() => {
          (trigger.props.onClick as () => void)();
        });

        assert.match(textOf(renderer.root), /Share this document/);
        assert.match(textOf(renderer.root), /Private/);
        const dialog = renderer.root.findByProps({ role: "dialog" });
        assert.match(dialog.props.className, /overflow-y-auto/);
        assert.equal(dialog.props.style.maxHeight, 704);
        assert.match(
          textOf(renderer.root),
          /Enable sharing to create a public read-only link/,
        );
        assert.match(
          textOf(renderer.root),
          /Enable document sharing to post to social platforms/,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("toggling the switch on calls toggleDocumentSharing(id, true) and renders the shared link + social intents on success", async () => {
    await withShareDom(async () => {
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared={false}
          initialShareId={null}
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });
        const toggle = renderer.root.findByProps({
          "aria-labelledby": "share-toggle-label",
        });

        await act(async () => {
          await (toggle.props.onCheckedChange as (v: boolean) => Promise<void>)(
            true,
          );
        });

        assert.deepEqual(
          globalForActions.__shareButtonActionsTestState.toggleCalls,
          [{ id: "doc-1", isShared: true }],
        );
        const shareUrlInput = renderer.root.findByProps({
          "aria-label": "Public share link",
        });
        assert.equal(
          shareUrlInput.props.value,
          "https://textiq.test/share/quarterly-plan-share123",
        );
        assert.match(textOf(renderer.root), /Share on X \/ Twitter/);
        assert.match(textOf(renderer.root), /Share on LinkedIn/);
        assert.match(textOf(renderer.root), /Share on Facebook/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed toggle surfaces the server error and leaves the panel private", async () => {
    await withShareDom(async () => {
      globalForActions.__shareButtonActionsTestState.toggleImpl = async () => ({
        ok: false,
        error: "Only the owner can enable sharing.",
      });
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared={false}
          initialShareId={null}
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });
        const toggle = renderer.root.findByProps({
          "aria-labelledby": "share-toggle-label",
        });
        await act(async () => {
          await (toggle.props.onCheckedChange as (v: boolean) => Promise<void>)(
            true,
          );
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Only the owner can enable sharing\./,
        );
        assert.match(textOf(renderer.root), /Private/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected sharing transport surfaces a retryable alert and unlocks the switch", async () => {
    await withShareDom(async () => {
      globalForActions.__shareButtonActionsTestState.toggleImpl = async () => {
        throw new Error("connection reset");
      };
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared={false}
          initialShareId={null}
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });
        const toggle = renderer.root.findByProps({
          "aria-labelledby": "share-toggle-label",
        });
        await act(async () => {
          await (toggle.props.onCheckedChange as (v: boolean) => Promise<void>)(
            true,
          );
        });

        assert.equal(
          textOf(
            renderer.root.findByProps({ role: "alert" }).findByType("span"),
          ),
          "Couldn't update document sharing. Please try again.",
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-labelledby": "share-toggle-label",
          }).props.disabled,
          false,
        );
        act(() => {
          findByAria(renderer.root, "Dismiss sharing error").props.onClick();
        });
        assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("same-event sharing activation submits one mutation and locks every policy control", async () => {
    await withShareDom(async () => {
      let resolveToggle!: (value: ActionResult<ShareSettings>) => void;
      globalForActions.__shareButtonActionsTestState.toggleImpl = () =>
        new Promise((resolve) => {
          resolveToggle = resolve;
        });
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared={false}
          initialShareId={null}
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });
        const toggle = renderer.root.findByProps({
          "aria-labelledby": "share-toggle-label",
        });
        let first!: Promise<void>;
        let duplicate!: Promise<void>;
        act(() => {
          first = toggle.props.onCheckedChange(true) as Promise<void>;
          duplicate = toggle.props.onCheckedChange(true) as Promise<void>;
        });

        assert.deepEqual(
          globalForActions.__shareButtonActionsTestState.toggleCalls,
          [{ id: "doc-1", isShared: true }],
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-labelledby": "share-toggle-label",
          }).props.disabled,
          true,
        );

        resolveToggle({ ok: true, data: SHARED_SETTINGS });
        await act(async () => {
          await Promise.all([first, duplicate]);
        });

        assert.match(textOf(renderer.root), /Public link enabled/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Next navigation control flow escapes share mutation recovery", async () => {
    const frameworkError = new Error("NEXT_REDIRECT:/login");
    await assert.rejects(
      () =>
        resolveShareMutation(
          () => Promise.reject(frameworkError),
          "fallback should not be returned",
        ),
      (error: unknown) => error === frameworkError,
    );
  });

  test("copying the link calls navigator.clipboard.writeText and shows a transient Copied! label", async (t) => {
    await withShareDom(async () => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const clipboard = installClipboard();
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        const copyButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Copy")!;
        await act(async () => {
          await (copyButton.props.onClick as () => Promise<void>)();
        });

        assert.deepEqual(clipboard.calls, [
          "https://textiq.test/share/quarterly-plan-share123",
        ]);
        assert.match(textOf(renderer.root), /Copied!/);

        act(() => {
          t.mock.timers.tick(2000);
        });
        assert.doesNotMatch(textOf(renderer.root), /Copied!/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("copying the link reports pending work before announcing success", async () => {
    await withShareDom(async () => {
      const calls: string[] = [];
      let resolveWrite!: () => void;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          clipboard: {
            writeText(text: string) {
              calls.push(text);
              return new Promise<void>((resolve) => {
                resolveWrite = resolve;
              });
            },
          },
        },
      });
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        const copyButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Copy")!;
        let pendingCopy!: Promise<void>;
        act(() => {
          pendingCopy = copyButton.props.onClick() as Promise<void>;
        });

        assert.deepEqual(calls, [
          "https://textiq.test/share/quarterly-plan-share123",
        ]);
        assert.match(textOf(renderer.root), /Copying…/);
        assert.match(textOf(renderer.root), /Copying public share link\./);
        assert.doesNotMatch(textOf(renderer.root), /Copied!/);

        resolveWrite();
        await act(async () => {
          await pendingCopy;
        });

        assert.match(textOf(renderer.root), /Copied!/);
        assert.match(textOf(renderer.root), /Public share link copied\./);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("regenerating the link shows a pending label, disables the button, and applies the new link on success", async () => {
    await withShareDom(async () => {
      let resolveRegenerate!: (value: ActionResult<ShareSettings>) => void;
      globalForActions.__shareButtonActionsTestState.regenerateImpl = () =>
        new Promise((resolve) => {
          resolveRegenerate = resolve;
        });

      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        const regenerateButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node).startsWith("Regenerate"))!;
        let pendingCall!: Promise<void>;
        act(() => {
          pendingCall = regenerateButton.props.onClick() as Promise<void>;
        });

        assert.match(textOf(renderer.root), /Regenerating…/);
        assert.equal(
          renderer.root
            .findAllByType("button")
            .find((node) => textOf(node).startsWith("Regenerat"))!.props
            .disabled,
          true,
        );

        resolveRegenerate({
          ok: true,
          data: { ...SHARED_SETTINGS, shareId: "share456" },
        });
        await act(async () => {
          await pendingCall;
        });

        assert.deepEqual(
          globalForActions.__shareButtonActionsTestState.regenerateCalls,
          ["doc-1"],
        );
        const shareUrlInput = renderer.root.findByProps({
          "aria-label": "Public share link",
        });
        assert.equal(
          shareUrlInput.props.value,
          "https://textiq.test/share/quarterly-plan-share456",
        );
        assert.match(textOf(renderer.root), /Regenerate link/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("setting an expiry converts the datetime-local value to an ISO instant and calls updateSharePolicy; Clear sends null", async () => {
    await withShareDom(async () => {
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        const expiryInput = renderer.root.findByProps({
          "aria-label": "Link expiry date and time",
        });
        await act(async () => {
          await (expiryInput.props.onChange as (e: unknown) => Promise<void>)({
            target: { value: "2030-01-01T10:00" },
          });
        });

        assert.equal(
          globalForActions.__shareButtonActionsTestState.policyCalls.length,
          1,
        );
        assert.equal(
          globalForActions.__shareButtonActionsTestState.policyCalls[0].id,
          "doc-1",
        );
        assert.equal(
          globalForActions.__shareButtonActionsTestState.policyCalls[0].policy
            .expiresAt,
          new Date("2030-01-01T10:00").toISOString(),
        );

        const clearButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Clear")!;
        await act(async () => {
          await (clearButton.props.onClick as () => Promise<void>)();
        });

        assert.equal(
          globalForActions.__shareButtonActionsTestState.policyCalls[1].policy
            .expiresAt,
          null,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("embed/present access toggles, metadata mode, and discoverable each call updateSharePolicy with the matching field", async () => {
    await withShareDom(async () => {
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        await act(async () => {
          await (
            renderer.root.findByProps({
              "aria-labelledby": "share-embed-allow-label",
            }).props.onCheckedChange as (v: boolean) => Promise<void>
          )(false);
        });
        await act(async () => {
          await (
            renderer.root.findByProps({
              "aria-labelledby": "share-present-allow-label",
            }).props.onCheckedChange as (v: boolean) => Promise<void>
          )(false);
        });
        await act(async () => {
          await (
            renderer.root.findByProps({ value: "title-excerpt" }).parent!.props
              .onChange as (e: unknown) => Promise<void>
          )({ target: { value: "title-excerpt" } });
        });
        await act(async () => {
          await (
            renderer.root.findByProps({
              "aria-labelledby": "share-discoverable-label",
            }).props.onCheckedChange as (v: boolean) => Promise<void>
          )(true);
        });

        const policies = globalForActions.__shareButtonActionsTestState
          .policyCalls as Array<{
          id: string;
          policy: Record<string, unknown>;
        }>;
        assert.deepEqual(
          policies.map((call) => call.policy),
          [
            { embedEnabled: false },
            { presentEnabled: false },
            { metadataMode: "title-excerpt" },
            { discoverable: true },
          ],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("setting then clearing a passcode calls updateSharePolicy and reflects Update/Remove-passcode state", async () => {
    await withShareDom(async () => {
      globalForActions.__shareButtonActionsTestState.policyImpl = async (
        _id,
        policy,
      ) => ({
        ok: true,
        data: {
          ...SHARED_SETTINGS,
          passcodeEnabled:
            policy.passcode !== null && policy.passcode !== undefined,
        },
      });
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        const passcodeInput = renderer.root.findByProps({
          "aria-label": "Share passcode",
        });
        assert.equal(passcodeInput.props.minLength, 4);
        assert.equal(passcodeInput.props.maxLength, 128);
        assert.equal(
          renderer.root
            .findAllByType("button")
            .find((node) => textOf(node) === "Set")!.props.disabled,
          true,
        );
        act(() => {
          (passcodeInput.props.onChange as (e: unknown) => void)({
            target: { value: "hunter2" },
          });
        });
        const setButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Set")!;
        await act(async () => {
          await (setButton.props.onClick as () => Promise<void>)();
        });

        assert.deepEqual(
          globalForActions.__shareButtonActionsTestState.policyCalls[0].policy,
          { passcode: "hunter2" },
        );
        assert.match(textOf(renderer.root), /Update/);
        assert.match(textOf(renderer.root), /Remove passcode/);
        assert.equal(
          renderer.root.findByProps({ "aria-label": "Share passcode" }).props
            .value,
          "",
        );
        assert.equal(
          renderer.root
            .findAllByType("button")
            .find((node) => textOf(node) === "Update")!.props.disabled,
          true,
        );

        const removeButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Remove passcode")!;
        await act(async () => {
          await (removeButton.props.onClick as () => Promise<void>)();
        });

        assert.deepEqual(
          globalForActions.__shareButtonActionsTestState.policyCalls[1].policy,
          { passcode: null },
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected updateSharePolicy call surfaces the server error as an alert", async () => {
    await withShareDom(async () => {
      globalForActions.__shareButtonActionsTestState.policyImpl = async () => ({
        ok: false,
        error: "Passcode must be at least 4 characters.",
      });
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });
        const passcodeInput = renderer.root.findByProps({
          "aria-label": "Share passcode",
        });
        act(() => {
          (passcodeInput.props.onChange as (e: unknown) => void)({
            target: { value: "x" },
          });
        });
        const setButton = renderer.root
          .findAllByType("button")
          .find((node) => textOf(node) === "Set")!;
        await act(async () => {
          await (setButton.props.onClick as () => Promise<void>)();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Passcode must be at least 4 characters\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("copyEmbed / copyPresentLink write the embed snippet / present URL and are gated on the embed/present access + share URL", async () => {
    await withShareDom(async () => {
      const clipboard = installClipboard();
      const renderer = mountWithPortalDom(
        <ShareButton
          id="doc-1"
          initialIsShared
          initialShareId="share123"
          initialSlug="quarterly-plan"
        />,
      );
      try {
        act(() => {
          (findByAria(renderer.root, "Share").props.onClick as () => void)();
        });

        // Locate the embed-section Copy button unambiguously via the textarea
        // that precedes it in the same bordered row.
        function embedButton() {
          return renderer.root
            .findAllByType("textarea")
            .find((node) => node.props["aria-label"] === "Embed code")!
            .parent!.findAllByType("button")
            .find((node) => node.props.onClick)!;
        }
        await act(async () => {
          await (embedButton().props.onClick as () => Promise<void>)();
        });
        assert.match(
          clipboard.calls[0],
          /^<iframe src="https:\/\/textiq\.test\/embed\/quarterly-plan-share123"/,
        );
        // Re-query after the state update: a previously-captured
        // `ReactTestInstance` can throw "Unable to find node on an unmounted
        // component" once React commits the re-render, even though the same
        // host element stays mounted.
        assert.equal(textOf(embedButton()), "Copied!");

        function presentButton() {
          return renderer.root
            .findAllByType("input")
            .find((node) => node.props["aria-label"] === "Presentation link")!
            .parent!.findAllByType("button")
            .find((node) => node.props.onClick)!;
        }
        await act(async () => {
          await (presentButton().props.onClick as () => Promise<void>)();
        });
        assert.equal(
          clipboard.calls[1],
          "https://textiq.test/present/quarterly-plan-share123",
        );
        assert.equal(textOf(presentButton()), "Copied!");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
