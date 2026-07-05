import "server-only";

import { cookies } from "next/headers";

import { auth } from "@/lib/env";
import type { ShareAccessFields } from "@/lib/share-access";
import {
  isSharePasscodeUnlockTokenValid,
  sharePasscodeCookieName,
} from "@/lib/share-passcode";

export async function isPublicSharePasscodeUnlocked(
  document: ShareAccessFields,
  shareId: string,
): Promise<boolean> {
  if (!document.sharePasscodeHash) return true;
  const secret = auth.secret();
  if (!secret) return false;

  const cookieStore = await cookies();
  return isSharePasscodeUnlockTokenValid({
    token: cookieStore.get(sharePasscodeCookieName(shareId))?.value,
    shareId,
    passcodeHash: document.sharePasscodeHash,
    secret,
  });
}
