"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { requireDocumentActionContext } from "./document-context";
import {
  setDocumentSharing,
  regenerateDocumentShareLink,
  updateDocumentSharePolicyData,
} from "@/lib/document/persistence-service";
import type { ShareSettings } from "@/lib/document/persistence-types";
import {
  hashSharePasscode,
  normalizeSharePasscode,
  validateSharePasscode,
} from "@/lib/share-passcode";

// Furthest-out expiry a caller may set, guarding against absurd dates.
const MAX_SHARE_EXPIRY_MS = 5 * 365 * 24 * 60 * 60 * 1000; // ~5 years

/**
 * Toggles sharing for a document owned by the current user.
 *
 * - When enabling sharing (isShared: true), generates a unique shareId and a
 *   decorative slug.
 * - When disabling sharing (isShared: false), clears the shareId, slug, and any
 *   expiry so a re-enable starts from a clean policy.
 * - Returns the full {@link ShareSettings} (link + lifecycle policy).
 *
 * Requires manage access (owner-level); a viewer, editor, or unrelated user is
 * rejected with a clear error via `requireDocumentCapability` (issue #89) so it
 * never modifies a document the user may not manage.
 */
export async function toggleDocumentSharing(
  id: string,
  isShared: boolean,
): Promise<ActionResult<ShareSettings>> {
  await requireDocumentActionContext(id, "manage");
  const settings = await setDocumentSharing(id, isShared);

  revalidatePath(`/app/documents/${id}`);
  revalidatePath("/app");

  return actionOk(settings);
}

/**
 * Rotates the share link: generates a brand-new `shareId` (and refreshes the
 * decorative slug) so the OLD link immediately stops resolving on every public
 * route (issue #101 AC #1). Sharing must already be enabled; the lifecycle
 * policy (expiry, embed/present flags) is preserved.
 *
 * Requires manage access (owner-level) via `requireDocumentCapability`.
 */
export async function regenerateShareLink(
  id: string,
): Promise<ActionResult<ShareSettings>> {
  await requireDocumentActionContext(id, "manage");
  const settings = await regenerateDocumentShareLink(id);
  if (!settings) {
    return actionError("Enable sharing before regenerating the link.");
  }

  revalidatePath(`/app/documents/${id}`);
  revalidatePath("/app");

  return actionOk(settings);
}

/**
 * Updates the share-link lifecycle/access policy (issue #101 AC #2 & #3):
 * link expiry, and whether the embed and presentation modes are reachable for
 * the shared document. Each field is optional — omitted fields are left
 * unchanged; passing `expiresAt: null` clears the expiry.
 *
 * `expiresAt` is accepted as an ISO-8601 string (or `null`) and validated: it
 * must parse to a real date and may not be set absurdly far in the future.
 *
 * Requires manage access (owner-level) via `requireDocumentCapability`.
 */
export async function updateSharePolicy(
  id: string,
  policy: {
    expiresAt?: string | null;
    embedEnabled?: boolean;
    presentEnabled?: boolean;
    metadataMode?: "generic" | "title" | "title-excerpt";
    discoverable?: boolean;
    passcode?: string | null;
  },
): Promise<ActionResult<ShareSettings>> {
  await requireDocumentActionContext(id, "manage");

  const data: {
    shareExpiresAt?: Date | null;
    shareEmbedEnabled?: boolean;
    sharePresentEnabled?: boolean;
    shareMetadataMode?: string;
    shareDiscoverable?: boolean;
    sharePasscodeHash?: string | null;
  } = {};

  if ("expiresAt" in policy) {
    if (policy.expiresAt === null || policy.expiresAt === "") {
      data.shareExpiresAt = null;
    } else {
      const parsed = new Date(policy.expiresAt as string);
      if (Number.isNaN(parsed.getTime())) {
        return actionError("Invalid expiry date.");
      }
      if (parsed.getTime() - Date.now() > MAX_SHARE_EXPIRY_MS) {
        return actionError("Expiry date is too far in the future.");
      }
      data.shareExpiresAt = parsed;
    }
  }

  if (typeof policy.embedEnabled === "boolean") {
    data.shareEmbedEnabled = policy.embedEnabled;
  }
  if (typeof policy.presentEnabled === "boolean") {
    data.sharePresentEnabled = policy.presentEnabled;
  }
  if (typeof policy.metadataMode === "string") {
    if (!["generic", "title", "title-excerpt"].includes(policy.metadataMode)) {
      return actionError("Invalid metadata mode.");
    }
    data.shareMetadataMode = policy.metadataMode;
  }
  if (typeof policy.discoverable === "boolean") {
    data.shareDiscoverable = policy.discoverable;
  }
  if ("passcode" in policy) {
    const passcode = normalizeSharePasscode(policy.passcode);
    if (!passcode) {
      data.sharePasscodeHash = null;
    } else {
      const validation = validateSharePasscode(passcode);
      if (!validation.ok) {
        return actionError(validation.message);
      }
      data.sharePasscodeHash = await hashSharePasscode(passcode);
    }
  }

  const settings = await updateDocumentSharePolicyData(id, data);

  revalidatePath(`/app/documents/${id}`);
  revalidatePath("/app");

  return actionOk(settings);
}
