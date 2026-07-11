import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Next.js 16 "proxy" convention (formerly "middleware"): runs on every matched
// request and performs the optimistic auth check defined by
// `authConfig.callbacks.authorized` (guarding `/app/*` and bouncing logged-in
// users off `/login` and `/signup`). It uses the lightweight, provider-free
// `authConfig` so the proxy never bundles Prisma/bcrypt.
const { auth } = NextAuth(authConfig);
export const proxy = auth;
// Next.js requires `config.matcher` to be a statically analyzable literal at
// build time, so it is kept inline here and mirrors
// `routeProtectionPolicy.proxy.matcher` (kept in sync manually).
export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon.ico).*)",
  ],
};
