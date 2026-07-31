"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { signOut } from "@/auth";
import { actionError, actionOk } from "@/lib/action-result";
import { deleteAccountForUser } from "@/lib/account/deletion-service";
import { changePasswordForUser } from "@/lib/auth/credentials-service";
import { requestEmailVerificationForUser } from "@/lib/auth/email-verification-service";
import type {
  DeleteAccountResult,
  PasswordResult,
  ProfileResult,
  VerifyEmailResult,
} from "@/lib/auth/form-state";
import { prisma } from "@/lib/prisma";
import { retryMessage, withAbuseBudget } from "@/lib/server-action-abuse";
import { requireUser } from "@/lib/session";

/** Maximum stored display-name length. */
const MAX_NAME_LENGTH = 100;

/**
 * Updates the current user's display name.
 *
 * The write is scoped to the authenticated user by keying on the session
 * `user.id` (never a client-supplied id), so it can only change the caller's own
 * profile. The name is trimmed and length-clamped; an empty value clears the name
 * (stored as `null`) so the header/menu falls back to the email.
 *
 * The header user menu and dashboard greeting read the name/email server-side
 * from the database, so revalidating the root layout makes a saved change show
 * immediately and persist after reload (the JWT session token still holds the
 * name captured at sign-in).
 */
export async function updateProfile(
  _prevState: ProfileResult | null,
  formData: FormData,
): Promise<ProfileResult> {
  const user = await requireUser(redirect);

  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);

  await prisma.user.update({
    where: { id: user.id },
    data: { name: name || null },
  });

  revalidatePath("/app/settings");
  revalidatePath("/", "layout");

  return actionOk({ name });
}

/**
 * Changes (or sets) the current user's password.
 *
 * Scoped to the authenticated user by keying on the session `user.id` (never a
 * client-supplied id). For an account that already has a password the caller
 * must prove they know the current one (verified with bcrypt); a Google-only
 * account (no `passwordHash`) can *set* a password without a current one. The
 * new password and its confirmation are validated by the pure
 * `validatePasswordChange` helper, and an incorrect current password yields a
 * generic message so nothing about the account is leaked. A successful
 * credential rotation invalidates every existing JWT, including this one, so
 * the action signs the browser out immediately instead of leaving a visibly
 * authenticated page backed by a stale session.
 */
export async function changePassword(
  _prevState: PasswordResult | null,
  formData: FormData,
): Promise<PasswordResult> {
  const user = await requireUser(redirect);
  const result = await withAbuseBudget(
    "account.change-password.user",
    user.id,
    async () =>
      changePasswordForUser({
        userId: user.id,
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword"),
        confirmPassword: formData.get("confirmPassword"),
      }),
    (retryAfterSecs) => actionError(retryMessage(retryAfterSecs)),
  );
  if (!result.ok) {
    return result;
  }

  await signOut({ redirectTo: "/login?passwordChanged=1" });
  // Unreachable in production because signOut redirects by throwing. The
  // return keeps the action total for adapters and tests whose signOut seam
  // resolves normally.
  return result;
}

/**
 * Permanently deletes the current user's account.
 *
 * Scoped to the authenticated user by keying the delete on the session
 * `user.id` (never a client-supplied id), so a caller can only delete their own
 * account. As a guard against accidents the caller must confirm by typing their
 * exact email address (case-insensitive) or the literal word "DELETE".
 *
 * Deleting the `User` row cascades — via the schema's `onDelete: Cascade`
 * relations — to the user's owned documents (and each document's visuals and
 * comments), owned workspaces (and their memberships and invite links), their
 * workspace memberships, and the comments they authored on other documents.
 *
 * On success the session cookie is cleared and the user is sent to the marketing
 * home. `signOut` performs that redirect by throwing, so it must run last and
 * stay outside any try/catch (the trailing return is unreachable but satisfies
 * the action's return type).
 */
export async function deleteAccount(
  _prevState: DeleteAccountResult | null,
  formData: FormData,
): Promise<DeleteAccountResult> {
  const user = await requireUser(redirect);
  const result = await deleteAccountForUser({
    userId: user.id,
    confirmation: formData.get("confirmation"),
  });
  if (!result.ok) {
    return result;
  }

  await signOut({ redirectTo: "/" });
  // Unreachable: signOut redirects by throwing. Returned only to satisfy the
  // action's return type.
  return actionOk();
}

/**
 * Sends an email-verification link to the current user's own address (#162).
 *
 * Scoped to the authenticated user by keying on the session `user.id` (never a
 * client-supplied id). There is no user-enumeration concern — the recipient is
 * the logged-in user's own, already-known email — so this returns specific
 * states. If the address is already verified it short-circuits. Otherwise it
 * generates a high-entropy token, stores only its HASH with a short expiry (so a
 * database leak can't be replayed), invalidates the user's other outstanding
 * verification tokens, and hands the raw-token link to the delivery seam.
 */
export async function requestEmailVerification(
  _prevState: VerifyEmailResult | null,
  _formData: FormData,
): Promise<VerifyEmailResult> {
  const user = await requireUser(redirect);
  return withAbuseBudget(
    "auth.email-verification.user",
    user.id,
    async () => requestEmailVerificationForUser(user.id),
    (retryAfterSecs) => actionError(retryMessage(retryAfterSecs)),
  );
}
