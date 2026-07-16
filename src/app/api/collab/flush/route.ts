/**
 * POST /api/collab/flush — internal best-effort recovery snapshot endpoint (#497).
 *
 * The collaboration server (`scripts/collab-core.mjs`) cannot import the
 * TypeScript Prisma stack, so when a dirty room is evicted it POSTs the room's
 * Yjs update (base64) here via `scripts/collab-flush.mjs`. This route persists
 * that update as a **best-effort recovery snapshot** on the `Document` so edits
 * that never reached the canonical `contentJson` autosave are not silently lost.
 *
 * IMPORTANT: this is NOT the source of truth. `Document.contentJson` remains
 * canonical (written by the editor's client autosave). The snapshot is a
 * recovery aid only — it is deliberately NOT converted to `contentJson` here
 * (server-side Yjs→Lexical conversion is a separate, risky concern and a
 * non-goal). Nothing reads the snapshot on the normal load path.
 *
 * Auth: an internal shared secret header (`x-collab-internal-secret`), compared
 * in constant time. When `COLLAB_INTERNAL_SECRET` is unset the endpoint is
 * disabled (503) so it can never be hit unauthenticated in a misconfigured
 * deploy. A missing/invalid secret is rejected 401.
 *
 * Responses:
 *   - 503 — feature disabled (no server secret configured).
 *   - 401 — missing/invalid internal secret.
 *   - 400 — malformed body (missing documentId or invalid base64 update).
 *   - 404 — the document does not exist (the route never creates rows).
 *   - 200 — `{ ok: true }` snapshot persisted.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { checkAbuseBudget } from "@/lib/abuse-budget";
import {
  featureDisabled,
  notFound,
  tooManyRequests,
  unauthorized,
  validationError,
} from "@/lib/api/errors";
import { updateDocumentMetadata } from "@/lib/document/document-write-port";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { readJsonValue } from "@/lib/api/route-adapters";

import { parseCollabFlushPayload } from "./parser";

export const runtime = "nodejs";

const LOG_SCOPE = "api.collab.flush";
const SECRET_HEADER = "x-collab-internal-secret";
const COLLAB_FLUSH_JSON_MAX_BYTES = 512 * 1024;

/** Constant-time string comparison that never throws on length mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.COLLAB_INTERNAL_SECRET?.trim();
  if (!expectedSecret) {
    return featureDisabled("Collaboration flush is disabled.");
  }

  const provided = request.headers.get(SECRET_HEADER);
  if (!provided || !secretsMatch(provided, expectedSecret)) {
    return unauthorized();
  }

  const json = await readJsonValue(request, "Invalid JSON body.", {
    maxBytes: COLLAB_FLUSH_JSON_MAX_BYTES,
    tooLargeMessage: "Collaboration flush body is too large.",
  });
  if (!json.ok) {
    return json.response.status === 413
      ? validationError("Collaboration flush body is too large.", 413)
      : validationError("Invalid JSON body.");
  }

  const parsed = parseCollabFlushPayload(json.body);
  if (!parsed.ok) {
    return validationError(parsed.message);
  }
  const { documentId, update } = parsed.payload;
  const budget = await checkAbuseBudget({
    namespace: "collab.flush.room",
    subject: documentId,
    secret: expectedSecret,
  });
  if (!budget.allowed) {
    return tooManyRequests(
      budget.retryAfterSeconds,
      "Too many collaboration flushes.",
    );
  }

  // Never create rows — only snapshot onto an existing document.
  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  });

  if (!existing) {
    logInfo(LOG_SCOPE, "flush rejected: document not found", { documentId });
    return notFound();
  }

  try {
    await updateDocumentMetadata(prisma, {
      where: { id: documentId },
      data: {
        collabRecoverySnapshot: update,
        collabRecoverySavedAt: new Date(),
      },
    });
  } catch (error) {
    logError(LOG_SCOPE, error, { documentId });
    return NextResponse.json(
      { error: "Failed to persist snapshot." },
      { status: 500 },
    );
  }

  logInfo(LOG_SCOPE, "recovery snapshot persisted", {
    documentId,
    bytes: Buffer.from(update, "base64").length,
  });

  return NextResponse.json({ ok: true });
}
