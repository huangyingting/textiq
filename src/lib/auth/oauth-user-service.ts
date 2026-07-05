import { normalizeEmail } from "@/lib/auth/password";
import { seedSampleDocument } from "@/lib/onboarding/seed-sample-document";
import { prisma } from "@/lib/prisma";

type PrismaClientLike = typeof prisma;

export type OAuthLocalUserInput = {
  email: string;
  name?: string | null;
  image?: string | null;
};

export type OAuthLocalUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  sessionInvalidatedAt: Date | null;
};

export async function linkOAuthLocalUser(
  input: OAuthLocalUserInput,
  options: {
    client?: Pick<PrismaClientLike, "user">;
    seedNewUser?: (userId: string) => Promise<void>;
  } = {},
): Promise<OAuthLocalUser> {
  const client = options.client ?? prisma;
  const seedNewUser = options.seedNewUser ?? seedSampleDocument;
  const email = normalizeEmail(input.email);

  if (!email) {
    throw new Error("OAuth user email is required for local account linking.");
  }

  const existing = await client.user.findUnique({ where: { email } });
  const dbUser = existing
    ? await client.user.update({
        where: { email },
        data: {
          name: input.name ?? undefined,
          image: input.image ?? undefined,
        },
      })
    : await client.user.create({
        /* node:coverage ignore next 5 -- New OAuth user creation payload is asserted; tsx maps object rows as uncovered. */
        data: {
          email,
          name: input.name ?? null,
          image: input.image ?? null,
        },
      });

  if (!existing) {
    await seedNewUser(dbUser.id);
  }

  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    image: dbUser.image,
    sessionInvalidatedAt: dbUser.sessionInvalidatedAt,
  };
}
