/**
 * Direct contract coverage for `DeleteAccountForm` (issue #1928).
 *
 * `computeDeleteAccountConfirmation` is the pure destructive-confirmation
 * decision extracted from the component: it decides whether the typed
 * confirmation text unlocks the destructive confirm button (matching the
 * account email case-insensitively, or the literal "DELETE" keyword) and
 * derives the three action descriptors (open/cancel/confirm) with their
 * pending-lockout `disabledReason` guidance. This is unit-tested directly,
 * independent of the portaled `ModalSurface`, which requires a live
 * `document` to render and is therefore exercised only through its safe,
 * closed-by-default markup below (no `document` exists in this Node test
 * environment, so `ModalSurface` renders nothing — see
 * `src/components/ui/overlay-stack.tsx`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  computeDeleteAccountConfirmation,
  DeleteAccountForm,
} from "./delete-account-form";

describe("computeDeleteAccountConfirmation", () => {
  test("blocks submission when the confirmation text is empty", () => {
    const result = computeDeleteAccountConfirmation({
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
    const result = computeDeleteAccountConfirmation({
      email: "Ada@Example.com",
      confirmation: "  ada@example.com  ",
      isPending: false,
    });
    assert.equal(result.canSubmit, true);
    assert.equal(result.confirmAction.disabledReason, undefined);
  });

  test("unlocks submission when the confirmation is the literal DELETE keyword", () => {
    const result = computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "DELETE",
      isPending: false,
    });
    assert.equal(result.canSubmit, true);
  });

  test("rejects a lowercase 'delete' keyword — only the exact-case literal matches", () => {
    const result = computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "delete",
      isPending: false,
    });
    assert.equal(result.canSubmit, false);
  });

  test("rejects an unrelated typed value even if non-empty", () => {
    const result = computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "not my email",
      isPending: false,
    });
    assert.equal(result.canSubmit, false);
  });

  test("pending locks the confirm and cancel buttons even when the confirmation matches", () => {
    const result = computeDeleteAccountConfirmation({
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
    assert.equal(result.confirmAction.label, "Deleting…");
  });

  test("idle confirm label reads 'Delete account' and the cancel button is unlocked", () => {
    const result = computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "",
      isPending: false,
    });
    assert.equal(result.confirmAction.label, "Delete account");
    assert.equal(result.cancelAction.disabledReason, undefined);
  });

  test("open action always exposes a stable id/label for the trigger button", () => {
    const result = computeDeleteAccountConfirmation({
      email: "ada@example.com",
      confirmation: "",
      isPending: false,
    });
    assert.equal(result.openAction.id, "settings.delete-account.open");
    assert.equal(result.openAction.label, "Delete account");
  });
});

describe("DeleteAccountForm", () => {
  test("renders the closed danger-zone trigger with the warning copy and no dialog markup", () => {
    const html = renderToStaticMarkup(
      <DeleteAccountForm email="ada@example.com" />,
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
