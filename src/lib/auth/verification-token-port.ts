import type { VerificationTokenPersistenceInput } from "@/lib/auth/verification-token";

export type VerificationTokenReconciliationInput = Readonly<{
  tokenHash: string;
  now: Date;
}>;

export type VerificationTokenInactiveReason = "missing" | "used" | "expired";

export type VerificationTokenReconciliationState =
  | { status: "active" }
  | { status: "inactive"; reason: VerificationTokenInactiveReason }
  | { status: "ambiguous" };

export interface VerificationTokenPort {
  create(input: VerificationTokenPersistenceInput): Promise<void>;
  reconcileByTokenHash(
    input: VerificationTokenReconciliationInput,
  ): Promise<VerificationTokenReconciliationState>;
}
