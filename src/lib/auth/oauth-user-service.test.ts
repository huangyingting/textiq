import assert from "node:assert/strict";
import { test } from "node:test";

import {
  linkOAuthLocalUser,
  type OAuthLocalUser,
} from "@/lib/auth/oauth-user-service";

type OAuthClient = NonNullable<
  NonNullable<Parameters<typeof linkOAuthLocalUser>[1]>["client"]
>;

type UserMutation = {
  where?: { email: string };
  data: { email?: string; name?: string | null; image?: string | null };
};

function oauthClientFixture(value: unknown): OAuthClient {
  return value as unknown as OAuthClient;
}

function oauthClient(input: {
  existing: OAuthLocalUser | null;
  createdId?: string;
  mutations?: UserMutation[];
  observedEmails?: string[];
}): OAuthClient {
  const mutations = input.mutations ?? [];
  const observedEmails = input.observedEmails ?? [];

  return oauthClientFixture({
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        observedEmails.push(where.email);
        return input.existing;
      },
      update: async (mutation: UserMutation) => {
        mutations.push(mutation);
        assert.ok(input.existing);
        return {
          ...input.existing,
          name:
            mutation.data.name === undefined
              ? input.existing.name
              : mutation.data.name,
          image:
            mutation.data.image === undefined
              ? input.existing.image
              : mutation.data.image,
          sessionInvalidatedAt: input.existing.sessionInvalidatedAt,
        };
      },
      create: async (mutation: UserMutation) => {
        mutations.push(mutation);
        return {
          id: input.createdId ?? "new_user",
          email: mutation.data.email!,
          name: mutation.data.name ?? null,
          image: mutation.data.image ?? null,
          sessionInvalidatedAt: null,
        };
      },
    },
  });
}

test("linkOAuthLocalUser updates an existing email-linked user without seeding", async () => {
  const mutations: UserMutation[] = [];
  const seedCalls: string[] = [];
  const client = oauthClient({
    existing: {
      id: "existing_user",
      email: "person@example.com",
      name: "Old Name",
      image: null,
      sessionInvalidatedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
    mutations,
  });

  const linked = await linkOAuthLocalUser(
    {
      email: "PERSON@example.com",
      name: "New Name",
      image: "https://lh3.googleusercontent.com/a/avatar",
    },
    {
      client,
      seedNewUser: async (userId) => {
        seedCalls.push(userId);
      },
    },
  );

  assert.deepEqual(linked, {
    id: "existing_user",
    email: "person@example.com",
    name: "New Name",
    image: "https://lh3.googleusercontent.com/a/avatar",
    sessionInvalidatedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  assert.deepEqual(seedCalls, []);
  assert.deepEqual(mutations, [
    {
      where: { email: "person@example.com" },
      data: {
        name: "New Name",
        image: "https://lh3.googleusercontent.com/a/avatar",
      },
    },
  ]);
});

test("linkOAuthLocalUser creates and seeds a brand-new OAuth user exactly once", async () => {
  const mutations: UserMutation[] = [];
  const observedEmails: string[] = [];
  const seedCalls: string[] = [];
  const client = oauthClient({
    existing: null,
    createdId: "new_user",
    mutations,
    observedEmails,
  });

  const linked = await linkOAuthLocalUser(
    { email: "  NEW@EXAMPLE.COM  ", name: null, image: null },
    {
      client,
      seedNewUser: async (userId) => {
        seedCalls.push(userId);
      },
    },
  );

  assert.deepEqual(observedEmails, ["new@example.com"]);
  assert.deepEqual(linked, {
    id: "new_user",
    email: "new@example.com",
    name: null,
    image: null,
    sessionInvalidatedAt: null,
  });
  assert.deepEqual(mutations, [
    {
      data: {
        email: "new@example.com",
        name: null,
        image: null,
      },
    },
  ]);
  assert.deepEqual(seedCalls, ["new_user"]);
});

test("linkOAuthLocalUser requires an email for local account linking", async () => {
  await assert.rejects(
    () =>
      linkOAuthLocalUser(
        { email: "" },
        {
          client: oauthClient({ existing: null }),
          seedNewUser: async () => {},
        },
      ),
    /OAuth user email is required/,
  );
});
