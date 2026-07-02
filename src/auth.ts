import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { authConfig } from "@/auth.config";
import { authorizeCredentialsUser } from "@/lib/auth/credentials-service";
import { google } from "@/lib/env";
import { isGoogleAuthConfigured } from "@/lib/auth/google-provider";
import { linkOAuthLocalUser } from "@/lib/auth/oauth-user-service";

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => authorizeCredentialsUser(credentials),
    }),
    ...(isGoogleAuthConfigured()
      ? [
          /* node:coverage ignore next 6 -- auth.test imports with complete Google env, but tsx maps this provider object continuation as uncovered. */
          Google({
            clientId: google.clientId(),
            clientSecret: google.clientSecret(),
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    signIn({ user, account }) {
      // OAuth sign-ins must carry an email so we can create/link a local user.
      if (account?.provider === "google") {
        return Boolean(user.email);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        const dbUser = await linkOAuthLocalUser({
          email: user.email,
          name: user.name,
          image: user.image,
        });
        token.id = dbUser.id;
      } else if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id;
      }
      return session;
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
