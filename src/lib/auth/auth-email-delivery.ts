/** Recipient and action URL for a password-reset email. */
export interface PasswordResetEmail {
  /** Recipient address (a real, matched user — never echoed back to clients). */
  to: string;
  /** Absolute, ready-to-click reset URL containing the raw token. */
  resetUrl: string;
}

/** Recipient and action URL for an email-verification email. */
export interface VerificationEmail {
  /** Recipient address (the logged-in user's own email). */
  to: string;
  /** Absolute, ready-to-click verification URL containing the raw token. */
  verifyUrl: string;
}

export type PasswordResetEmailMessage = PasswordResetEmail & {
  kind: "password-reset";
};

export type VerificationEmailMessage = VerificationEmail & {
  kind: "email-verification";
};

export type AuthEmailMessage =
  PasswordResetEmailMessage | VerificationEmailMessage;

/** Transport boundary for concrete authentication email messages. */
export interface AuthEmailDeliveryPort {
  send(message: AuthEmailMessage): Promise<void>;
}
