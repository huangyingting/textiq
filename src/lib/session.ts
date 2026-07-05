import { auth } from "@/auth";
import { isSessionSecurityStampCurrent } from "@/lib/auth/session-security";
import { prisma } from "@/lib/prisma";

export type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

interface SessionBackedUser {
  id: string;
  sessionInvalidatedAt: Date | null;
}

/**
 * Returns the currently authenticated user, or `null` when no valid session
 * exists. Safe to call from any server component, route handler, or action.
 */
/* node:coverage disable */
async function getSessionUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function getCurrentUser() {
  const user = await getSessionUser();
  if (!user?.id) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, sessionInvalidatedAt: true },
  });
  if (!dbUser) {
    return null;
  }

  if (
    !isSessionSecurityStampCurrent(
      user.sessionInvalidatedAt,
      dbUser.sessionInvalidatedAt,
    )
  ) {
    return null;
  }

  return user;
}
/* node:coverage enable */

interface RequireUserDependencies {
  getSessionUser(): Promise<CurrentUser>;
  findUserById(id: string): Promise<SessionBackedUser | null>;
}

export async function requireUserCore(
  dependencies: RequireUserDependencies,
  redirect: (url: string) => never,
) {
  const user = await dependencies.getSessionUser();
  if (!user?.id) {
    redirect("/login");
  }

  const dbUser = await dependencies.findUserById(user.id);
  if (!dbUser) {
    redirect("/signout");
  }

  if (
    !isSessionSecurityStampCurrent(
      user.sessionInvalidatedAt,
      dbUser.sessionInvalidatedAt,
    )
  ) {
    redirect("/signout");
  }

  return user;
}

/* node:coverage disable */
/**
 * Returns the currently authenticated user, or calls the supplied `redirect`
 * function when no valid session exists. The `redirect` parameter must be
 * injected by the caller (component or action layer), keeping this lib module
 * free of framework navigation dependencies and node-test-safe.
 *
 * Also defends against a "stale" session: with the JWT strategy the session can
 * be cryptographically valid while its user row no longer exists in the database
 * (e.g. after a local database reset or a deleted account). Left unchecked, the
 * missing owner surfaces as an opaque foreign-key violation on the first write
 * (`document.create({ ownerId })`). When the user can't be found we route to
 * `/signout`, which clears the stale cookie and returns to login.
 */
/* node:coverage enable */
export async function requireUser(redirect: (url: string) => never) {
  return requireUserCore(
    {
      getSessionUser,
      findUserById(id) {
        return prisma.user.findUnique({
          where: { id },
          select: { id: true, sessionInvalidatedAt: true },
        });
      },
    },
    redirect,
  );
}
