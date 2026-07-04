export type SessionSecurityStamp = string | null;

export interface SessionSecurityToken {
  id?: string;
  sessionInvalidatedAt?: SessionSecurityStamp;
}

export interface SessionSecurityUser {
  id: string;
  sessionInvalidatedAt?: Date | string | null;
}

export function normalizeSessionSecurityStamp(
  value: Date | string | null | undefined,
): SessionSecurityStamp {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function applySessionSecurityStampToToken<
  TToken extends SessionSecurityToken,
>(token: TToken, user: SessionSecurityUser): TToken {
  token.id = user.id;
  token.sessionInvalidatedAt = normalizeSessionSecurityStamp(
    user.sessionInvalidatedAt,
  );
  return token;
}

export function isSessionSecurityStampCurrent(
  sessionStamp: Date | string | null | undefined,
  currentStamp: Date | string | null | undefined,
): boolean {
  return (
    normalizeSessionSecurityStamp(sessionStamp) ===
    normalizeSessionSecurityStamp(currentStamp)
  );
}
