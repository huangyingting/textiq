import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import {
  getBillingProvider,
  shouldCancelSubscription,
  type BillingProvider,
} from "@/lib/billing/provider";
import {
  getSubscriptionCancellationState,
  type SubscriptionCancellationState,
} from "@/lib/billing/service";
import { logError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { logSecurityAudit } from "@/lib/security-audit";

import {
  eraseAccountPersonalData,
  type AccountErasureStorage,
} from "./erasure";
/* node:coverage ignore next -- Prisma client type alias is erased and only appears in source-map coverage. */
type PrismaClientLike = typeof prisma;

const DELETE_CONFIRMATION_KEYWORD = "DELETE";

const GENERIC_DELETE_ERROR = "Could not delete your account. Please try again.";
export const ACCOUNT_DELETION_CANONICAL_ERROR_CODE = "ACCOUNT_DELETION_FAILED";
const ACCOUNT_DELETION_CANONICAL_ERROR_MESSAGE =
  "Could not complete account deletion operation.";

export interface DeleteAccountDependencies {
  client?: PrismaClientLike;
  getCancellationState?: (
    userId: string,
  ) => Promise<SubscriptionCancellationState | null>;
  getProvider?: () => Promise<BillingProvider>;
  log?: typeof logError;
  audit?: typeof logSecurityAudit;
  erasureStorage?: AccountErasureStorage;
}

export async function deleteAccountForUser(
  input: { userId: string; confirmation: FormDataEntryValue | string | null },
  dependencies: DeleteAccountDependencies = {},
): Promise<ActionResult> {
  const {
    client = prisma,
    getCancellationState = getSubscriptionCancellationState,
    getProvider = getBillingProvider,
    log = logError,
    audit = logSecurityAudit,
    erasureStorage,
  } = dependencies;
  const confirmation = String(input.confirmation ?? "").trim();

  const dbUser = await client.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  if (!dbUser) {
    return actionError(GENERIC_DELETE_ERROR);
  }

  const matchesEmail =
    confirmation.toLowerCase() === dbUser.email.trim().toLowerCase();
  const matchesKeyword = confirmation === DELETE_CONFIRMATION_KEYWORD;
  if (!matchesEmail && !matchesKeyword) {
    return actionError(
      `Type your email or "${DELETE_CONFIRMATION_KEYWORD}" to confirm.`,
    );
  }

  try {
    const sub = await getCancellationState(input.userId);

    if (shouldCancelSubscription(sub)) {
      try {
        const billing = await getProvider();
        await billing.cancelSubscriptionImmediately(input.userId);
      } catch (err) {
        log("billing.subscription.cancel_immediate", err, {
          userId: input.userId,
          reason: "account-deletion",
        });
        audit("account.deletion.billing_reconciliation_required", {
          userId: input.userId,
          ...(sub?.stripeSubscriptionId
            ? { subscriptionId: sub.stripeSubscriptionId }
            : {}),
          ...(sub?.status ? { status: sub.status } : {}),
          reason: "stripe-cancellation-failed",
          outcome: "failed",
        });
      }
    }

    await client.user.update({
      where: { id: input.userId },
      data: { sessionInvalidatedAt: new Date() },
    });

    /* node:coverage ignore next 5 -- Erasure dependency payload is asserted through deletion outcomes; tsx maps the object literal as uncovered. */
    const erasure = await eraseAccountPersonalData({
      client,
      userId: input.userId,
      ...(erasureStorage ? { storage: erasureStorage } : {}),
    });
    if (erasure.findings.length > 0) {
      audit("account.deletion.erasure_verification_failed", {
        userId: input.userId,
        outcome: "failed",
        count: erasure.findings.reduce(
          (sum, finding) => sum + finding.count,
          0,
        ),
      });
      log(
        "account-deletion.erasure-verification",
        new Error("erasure failed"),
        {
          userId: input.userId,
          findingCount: erasure.findings.length,
        },
      );
      return actionError(GENERIC_DELETE_ERROR);
    }
    /* node:coverage ignore next 5 -- Success audit payload is asserted; tsx maps the object literal as uncovered. */
    audit("account.deletion.completed", {
      userId: input.userId,
      count: erasure.deletedAssetCount,
      outcome: "success",
    });
  } /* node:coverage ignore next -- Defensive catch behavior is asserted; tsx maps the catch boundary as uncovered. */ catch {
    const canonicalError = new Error(ACCOUNT_DELETION_CANONICAL_ERROR_MESSAGE);
    canonicalError.name = "AccountDeletionError";
    log("account-deletion", canonicalError, {
      userId: input.userId,
      stage: "account-deletion",
      code: ACCOUNT_DELETION_CANONICAL_ERROR_CODE,
    });
    return actionError(GENERIC_DELETE_ERROR);
  }

  return actionOk();
}
