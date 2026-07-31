export interface BillingActionData {
  message: string;
  redirectUrl?: string;
}

export const BILLING_ACTION_FAILURE_MESSAGE =
  "Could not update billing. Please try again.";
