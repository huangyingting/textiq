import { NextResponse, type NextRequest } from "next/server";

import { publicSharePasscodeBudgetExceeded } from "@/app/public-abuse";
import { auth } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  evaluateShareAccess,
  toShareAccessInput,
  type ShareMode,
} from "@/lib/share-access";
import {
  SHARE_PASSCODE_UNLOCK_MAX_AGE_SECONDS,
  createSharePasscodeUnlockToken,
  normalizeSharePasscode,
  sharePasscodeCookieName,
  verifySharePasscode,
} from "@/lib/share-passcode";

function modeFromForm(value: FormDataEntryValue | null): ShareMode {
  return value === "embed" || value === "present" ? value : "view";
}

function safeReturnPath(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "");
  if (
    raw.startsWith("/share/") ||
    raw.startsWith("/embed/") ||
    raw.startsWith("/present/")
  ) {
    return raw;
  }
  return "/share";
}

function redirectWithStatus(
  request: NextRequest,
  returnTo: string,
  status: "invalid" | "limited",
): NextResponse {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("passcode", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const shareId = normalizeSharePasscode(form.get("shareId"));
  const mode = modeFromForm(form.get("mode"));
  const returnTo = safeReturnPath(form.get("returnTo"));
  const passcode = normalizeSharePasscode(form.get("passcode"));

  if (!shareId) {
    return redirectWithStatus(request, returnTo, "invalid");
  }

  if (await publicSharePasscodeBudgetExceeded(shareId, request.headers)) {
    return redirectWithStatus(request, returnTo, "limited");
  }

  const document = await prisma.document.findFirst({
    where: { shareId },
    select: {
      shareId: true,
      isShared: true,
      deletedAt: true,
      shareExpiresAt: true,
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      sharePasscodeHash: true,
    },
  });

  if (!document?.sharePasscodeHash) {
    return NextResponse.redirect(new URL(returnTo, request.url), 303);
  }

  const decision = evaluateShareAccess(
    toShareAccessInput(document, shareId, mode, undefined, true),
  );
  if (!decision.allow) {
    return redirectWithStatus(request, returnTo, "invalid");
  }

  const passcodeMatches = await verifySharePasscode(
    passcode,
    document.sharePasscodeHash,
  );
  if (!passcodeMatches) {
    return redirectWithStatus(request, returnTo, "invalid");
  }

  const secret = auth.secret();
  if (!secret) {
    return redirectWithStatus(request, returnTo, "invalid");
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set({
    name: sharePasscodeCookieName(shareId),
    value: createSharePasscodeUnlockToken({
      shareId,
      passcodeHash: document.sharePasscodeHash,
      secret,
    }),
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" ||
      request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SHARE_PASSCODE_UNLOCK_MAX_AGE_SECONDS,
  });
  return response;
}
