/**
 * Direct contract coverage for `DeleteAccountForm` (issue #1928).
 *
 * `computeDeleteAccountConfirmation` is the pure destructive-confirmation
 * decision extracted from the component: it decides whether the typed
 * confirmation text unlocks the destructive confirm button (matching the
 * account email case-insensitively, or the literal "DELETE" keyword) and
 * derives the three action descriptors (open/cancel/confirm) with their
 * pending-lockout `disabledReason` guidance. The shared portal harness mounts
 * the real component lifecycle to cover same-turn submit/dismiss, duplicate
 * dispatch, accessible pending state, failure retry, and terminal success
 * ownership; server deletion policy remains covered by the action/service
 * tests.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { startTransition } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-test-renderer";

import "@/test/react-render-harness";
import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";

type DeleteResult = { ok: true } | { ok: false; error: string };

type DeleteAccountTestState = {
  calls: FormData[];
  impl: (
    previous: DeleteResult | null,
    payload: FormData,
  ) => Promise<DeleteResult>;
};

const globalForTest = globalThis as typeof globalThis & {
  __deleteAccountFormTestState: DeleteAccountTestState;
};

function resetState() {
  globalForTest.__deleteAccountFormTestState = {
    calls: [],
    impl: async () => ({ ok: false, error: "Account deletion failed." }),
  };
}

resetState();

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
const actionsStubUrl = "textiq-delete-account-form-actions:test";

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
        format: "module",
        source: `
          export async function deleteAccount(previous, payload) {
            const state = globalThis.__deleteAccountFormTestState;
            state.calls.push(payload);
            return state.impl(previous, payload);
          }
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type DeleteAccountFormModule = typeof import("./delete-account-form");
let mod: DeleteAccountFormModule;

before(async () => {
  mod = await import("./delete-account-form");
});

beforeEach(resetState);

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("computeDeleteAccountConfirmation", () => {
  test("blocks submission when the confirmation text is empty", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "",
      isPending: false,
    });
    assert.equal(result.canSubmit, false);
    assert.equal(
      result.confirmAction.disabledReason,
      "Type your email address or DELETE to confirm",
    );
  });

  test("unlocks submission when the confirmation matches the email case-insensitively", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "Ada@Example.com",
      confirmation: "  ada@example.com  ",
      isPending: false,
    });
    assert.equal(result.canSubmit, true);
    assert.equal(result.confirmAction.disabledReason, undefined);
  });

  test("unlocks submission when the confirmation is the literal DELETE keyword", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "DELETE",
      isPending: false,
    });
    assert.equal(result.canSubmit, true);
  });

  test("rejects a lowercase 'delete' keyword — only the exact-case literal matches", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "delete",
      isPending: false,
    });
    assert.equal(result.canSubmit, false);
  });

  test("rejects an unrelated typed value even if non-empty", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "not my email",
      isPending: false,
    });
    assert.equal(result.canSubmit, false);
  });

  test("pending locks the confirm and cancel buttons even when the confirmation matches", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "DELETE",
      isPending: true,
    });
    assert.equal(result.canSubmit, true);
    assert.equal(
      result.confirmAction.disabledReason,
      "Account deletion is in progress",
    );
    assert.equal(
      result.cancelAction.disabledReason,
      "Account deletion is in progress",
    );
    assert.equal(
      result.openAction.disabledReason,
      "Account deletion is in progress",
    );
    assert.equal(result.confirmAction.label, "Deleting…");
  });

  test("idle confirm label reads 'Delete account' and the cancel button is unlocked", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "",
      isPending: false,
    });
    assert.equal(result.confirmAction.label, "Delete account");
    assert.equal(result.cancelAction.disabledReason, undefined);
  });

  test("open action always exposes a stable id/label for the trigger button", () => {
    const result = mod.computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "",
      isPending: false,
    });
    assert.equal(result.openAction.id, "settings.delete-account.open");
    assert.equal(result.openAction.label, "Delete account");
  });
});

describe("DeleteAccountForm", () => {
  test("pending deletion suppresses duplicate dispatch and owns the dialog through failure or success", async () => {
    await withPortalDom(async () => {
      let resolveFirst!: (result: DeleteResult) => void;
      globalForTest.__deleteAccountFormTestState.impl = async () => {
        if (globalForTest.__deleteAccountFormTestState.calls.length === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return { ok: false, error: "Duplicate deletion reached the action." };
      };

      const renderer = mountWithPortalDom(
        <mod.DeleteAccountForm email="ada@example.com" />,
      );
      try {
        const trigger = renderer.root.findByType("button");
        act(() => {
          trigger.props.onClick();
        });
        const confirmation = renderer.root.findByProps({
          "aria-label": "Confirm account deletion",
        });
        act(() => {
          confirmation.props.onChange({ target: { value: "DELETE" } });
        });

        const formAction = renderer.root.findByType("form").props.action as (
          payload: FormData,
        ) => void;
        const modal = renderer.root.find(
          (instance) =>
            typeof instance.type !== "string" &&
            instance.props.open === true &&
            instance.props["aria-labelledby"] === "delete-account-title" &&
            typeof instance.props.onClose === "function",
        );
        const payload = new FormData();
        payload.set("confirmation", "DELETE");

        act(() => {
          startTransition(() => {
            formAction(payload);
            formAction(payload);
          });
          modal.props.onClose();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.equal(
          globalForTest.__deleteAccountFormTestState.calls.length,
          1,
        );
        const pendingDialog = renderer.root.findByProps({ role: "dialog" });
        assert.equal(pendingDialog.props["aria-busy"], true);
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Confirm account deletion",
          }).props.disabled,
          true,
        );
        const pendingButtons = renderer.root.findAllByType("button");
        assert.equal(
          pendingButtons.find((button) => button.children.join("") === "Cancel")
            ?.props.disabled,
          true,
        );
        assert.equal(
          pendingButtons.find(
            (button) => button.children.join("") === "Deleting…",
          )?.props.disabled,
          true,
        );
        assert.equal(
          pendingButtons.find(
            (button) => button.children.join("") === "Delete account",
          )?.props.disabled,
          true,
        );

        await act(async () => {
          resolveFirst({ ok: false, error: "Please try deletion again." });
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.equal(
          globalForTest.__deleteAccountFormTestState.calls.length,
          1,
        );
        assert.equal(
          renderer.root.findByProps({ role: "alert" }).children.join(""),
          "Please try deletion again.",
        );

        globalForTest.__deleteAccountFormTestState.impl = async () => ({
          ok: true,
        });
        const retryAction = renderer.root.findByType("form").props.action as (
          retryPayload: FormData,
        ) => void;
        act(() => {
          startTransition(() => retryAction(payload));
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.equal(
          globalForTest.__deleteAccountFormTestState.calls.length,
          2,
        );
        assert.equal(
          renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
          true,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders the closed danger-zone trigger with the warning copy and no dialog markup", () => {
    const html = renderToStaticMarkup(
      <mod.DeleteAccountForm email="ada@example.com" />,
    );
    assert.match(html, /Permanently delete your account/);
    assert.match(html, />Delete account</);
    // The dialog only mounts once `document` exists; this Node test
    // environment has none, so `ModalSurface` must render nothing (no
    // dialog role, no confirmation input) even though `open` starts false
    // regardless.
    assert.doesNotMatch(html, /role="dialog"/);
    assert.doesNotMatch(html, /Confirm account deletion/);
  });
});
