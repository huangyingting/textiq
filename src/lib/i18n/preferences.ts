export const LOCALE_COOKIE = "textiq-locale";

export const LOCALE_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  sameSite: "lax",
  httpOnly: true,
} as const;
