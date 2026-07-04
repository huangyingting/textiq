import { headers } from "next/headers";

import {
  checkAbuseBudget,
  getClientSubject,
  requireAbuseBudgetSecret,
} from "@/lib/abuse-budget";

export async function publicShareBudgetExceeded(): Promise<boolean> {
  const secret = requireAbuseBudgetSecret();
  if (!secret) return false;
  const requestHeaders = await headers();
  const budget = await checkAbuseBudget({
    namespace: "public.share.ip",
    subject: getClientSubject(requestHeaders),
    secret,
  });
  return !budget.allowed;
}

export async function publicSharePasscodeBudgetExceeded(
  shareId: string,
  requestHeaders: Headers,
): Promise<boolean> {
  const secret = requireAbuseBudgetSecret();
  if (!secret) return false;
  const budget = await checkAbuseBudget({
    namespace: "public.share-passcode.ip",
    subject: `${getClientSubject(requestHeaders)}:${shareId}`,
    secret,
  });
  return !budget.allowed;
}
