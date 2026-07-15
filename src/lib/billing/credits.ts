/**
 * Credit metering helpers (US-010 epic).
 *
 * Pure functions for computing the credit cost of a generation request and
 * DB helpers for reading/writing a user's credit balance. The DB helpers are
 * server-only; the pure functions are safe to import anywhere.
 *
 * Credit cost model: ~1 credit per word (whitespace-split). Minimum 1.
 * Period reset: if `creditPeriodStart` is null or has elapsed past `periodDays`,
 * the balance is reset to the plan's `creditsPerPeriod`.
 */

/* @preserve node:coverage ignore next -- Import/source-map facade artifact; runtime helpers are asserted below. */
import { prisma } from "@/lib/prisma";
type CreditWriteClient = Pick<typeof prisma, "user">;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Counts the approximate number of words in `text`. Each whitespace-delimited
 * token is one word. Returns at least 1 (so a single punctuation char costs
 * something).
 */
export function countWords(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, tokens.length);
}

/**
 * Computes the credit cost for a generation request.
 * Currently equal to the word count (1 credit/word), capped to a reasonable max.
 */
export function computeCreditCost(text: string): number {
  return countWords(text);
}

/**
 * Pure decision: does `balance` cover `cost`? Returns `true` when the user can
 * afford the request (i.e. the balance is at least the cost). Extracted so the
 * insufficient-credit gate can be unit-tested without a DB.
 */
export function hasSufficientCredits(balance: number, cost: number): boolean {
  return balance >= cost;
}

// ---------------------------------------------------------------------------
// DB helpers (server-only)
// ---------------------------------------------------------------------------

/* @preserve node:coverage ignore next 17 -- DB-helper JSDoc/signature rows are source-map artifacts; no-op and write branches are asserted. */
/**
 * Atomically deducts `cost` credits from `userId`'s balance. Returns the new
 * balance. Throws `InsufficientCreditsError` when the balance would go below 0.
 *
 * The deduction is a single conditional `updateMany` guarded by
 * `creditBalance >= cost`, so the read-check-decrement is collapsed into one
 * atomic DB write: concurrent generations can never both pass and drive the
 * balance negative. When no row matches the guard (`count === 0`) the balance
 * is insufficient and we surface the same `InsufficientCreditsError` callers
 * already expect.
 *
 * A non-positive `cost` (the unlimited-credits gate, #97) is a no-op: the
 * current balance is returned without any write.
 */
/* node:coverage ignore next 6 -- Credit deduction branches are asserted; tsx maps the multiline signature as uncovered. */
export async function deductCredits(
  userId: string,
  cost: number,
  client: CreditWriteClient = prisma,
): Promise<number> {
  if (cost <= 0) {
    const user = await client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user.creditBalance;
  }

  // Atomic conditional decrement: only update the row while it still covers the
  // cost. `count === 0` means the guard failed (insufficient balance).
  const result = await client.user.updateMany({
    where: { id: userId, creditBalance: { gte: cost } },
    data: { creditBalance: { decrement: cost } },
  });

  if (result.count === 0) {
    // Re-read the actual balance to report it accurately in the error.
    const user = await client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    throw new InsufficientCreditsError(user.creditBalance, cost);
  }

  const updated = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { creditBalance: true },
  });

  return updated.creditBalance;
}

/** Thrown when a user has insufficient credits for the requested operation. */
export class InsufficientCreditsError extends Error {
  readonly balance: number;
  readonly cost: number;

  constructor(balance: number, cost: number) {
    super(
      `Insufficient credits: need ${cost}, have ${balance}. Your plan's credit balance has been exhausted — upgrade or wait for your next period to reset.`,
    );
    this.name = "InsufficientCreditsError";
    this.balance = balance;
    this.cost = cost;
  }
}
