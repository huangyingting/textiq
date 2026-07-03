import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeCredentialsUser,
  changePasswordForUser,
  registerCredentialsUser,
  type AuthorizedCredentialsUser,
} from "@/lib/auth/credentials-service";
import { comparePassword, hashPassword } from "@/lib/auth/password";

type CredentialAuthClient = NonNullable<
  Parameters<typeof authorizeCredentialsUser>[1]
>;
type CredentialsWriteClient = Parameters<typeof registerCredentialsUser>[1];
type CredentialsWriteClientWithUpdates = CredentialsWriteClient & {
  _updates: Array<{ id: string; passwordHash: string }>;
};

function credentialAuthStub(value: unknown): CredentialAuthClient {
  return value as unknown as CredentialAuthClient;
}

function credentialsWriteStub(
  value: unknown,
): CredentialsWriteClientWithUpdates {
  return value as unknown as CredentialsWriteClientWithUpdates;
}

function credentialClient(
  user: (AuthorizedCredentialsUser & { passwordHash: string | null }) | null,
  observedEmails: string[] = [],
): CredentialAuthClient {
  return credentialAuthStub({
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        observedEmails.push(where.email);
        return user;
      },
    },
  });
}

test("authorizeCredentialsUser normalizes email and returns the DB user on password match", async () => {
  const passwordHash = await hashPassword("correct-password");
  const observedEmails: string[] = [];
  const client = credentialClient(
    {
      id: "user_1",
      email: "person@example.com",
      name: "Person",
      image: "https://example.com/avatar.png",
      passwordHash,
    },
    observedEmails,
  );

  const authorized = await authorizeCredentialsUser(
    { email: "  PERSON@EXAMPLE.COM ", password: "correct-password" },
    client,
  );

  assert.deepEqual(observedEmails, ["person@example.com"]);
  assert.deepEqual(authorized, {
    id: "user_1",
    email: "person@example.com",
    name: "Person",
    image: "https://example.com/avatar.png",
  });
});

test("authorizeCredentialsUser rejects missing credentials, missing hashes, and wrong passwords", async () => {
  assert.equal(
    await authorizeCredentialsUser(undefined, credentialClient(null)),
    null,
  );
  assert.equal(
    await authorizeCredentialsUser(
      { email: "person@example.com", password: "" },
      credentialClient(null),
    ),
    null,
  );
  assert.equal(
    await authorizeCredentialsUser(
      { email: "person@example.com", password: "secret" },
      credentialClient({
        id: "user_1",
        email: "person@example.com",
        name: null,
        image: null,
        passwordHash: null,
      }),
    ),
    null,
  );

  const passwordHash = await hashPassword("correct-password");
  assert.equal(
    await authorizeCredentialsUser(
      { email: "person@example.com", password: "wrong-password" },
      credentialClient({
        id: "user_1",
        email: "person@example.com",
        name: null,
        image: null,
        passwordHash,
      }),
    ),
    null,
  );
});

function credentialsWriteClient(options: {
  existing?: unknown;
  createError?: Error;
  passwordHash?: string | null;
}): CredentialsWriteClientWithUpdates {
  const updates: Array<{ id: string; passwordHash: string }> = [];
  const client = credentialsWriteStub({
    user: {
      findUnique: async ({
        where,
      }: {
        where: { email?: string; id?: string };
      }) =>
        where.id
          ? options.existing === undefined
            ? { passwordHash: options.passwordHash ?? null }
            : options.existing
          : (options.existing ?? null),
      create: async () => {
        if (options.createError) throw options.createError;
        return { id: "user_credentials" };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { passwordHash: string };
      }) => {
        updates.push({ id: where.id, passwordHash: data.passwordHash });
        return {};
      },
    },
  });
  client._updates = updates;
  return client;
}

test("registerCredentialsUser rejects invalid, duplicate, and failed-create inputs", async () => {
  assert.deepEqual(
    await registerCredentialsUser(
      { name: "Ada", email: "not-an-email", password: "valid-password" },
      credentialsWriteClient({}),
    ),
    { ok: false, error: "Enter a valid email address." },
  );
  assert.deepEqual(
    await registerCredentialsUser(
      { name: "Ada", email: "ada@example.com", password: "short" },
      credentialsWriteClient({}),
    ),
    { ok: false, error: "Password must be at least 8 characters." },
  );
  assert.deepEqual(
    await registerCredentialsUser(
      { name: "Ada", email: "ada@example.com", password: "valid-password" },
      credentialsWriteClient({ existing: { id: "existing-user" } }),
    ),
    { ok: false, error: "An account with this email already exists." },
  );
  assert.deepEqual(
    await registerCredentialsUser(
      { name: "Ada", email: "ada@example.com", password: "valid-password" },
      credentialsWriteClient({ createError: new Error("database down") }),
    ),
    { ok: false, error: "Could not create your account. Please try again." },
  );
});

test("changePasswordForUser validates current and replacement passwords", async () => {
  const currentHash = await hashPassword("current-password");

  assert.deepEqual(
    await changePasswordForUser(
      {
        userId: "missing-user",
        currentPassword: "current-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
      credentialsWriteClient({ existing: null }),
    ),
    {
      ok: false,
      error: "Could not change your password. Please try again.",
    },
  );

  assert.deepEqual(
    await changePasswordForUser(
      {
        userId: "user_credentials",
        currentPassword: "current-password",
        newPassword: "new-password",
        confirmPassword: "different-password",
      },
      credentialsWriteClient({ passwordHash: currentHash }),
    ),
    { ok: false, error: "New passwords don't match." },
  );

  assert.deepEqual(
    await changePasswordForUser(
      {
        userId: "user_credentials",
        currentPassword: "wrong-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
      credentialsWriteClient({ passwordHash: currentHash }),
    ),
    { ok: false, error: "Your current password is incorrect." },
  );

  assert.deepEqual(
    await changePasswordForUser(
      {
        userId: "user_credentials",
        currentPassword: "current-password",
        newPassword: "current-password",
        confirmPassword: "current-password",
      },
      credentialsWriteClient({ passwordHash: currentHash }),
    ),
    {
      ok: false,
      error: "New password must be different from your current password.",
    },
  );
});

test("changePasswordForUser stores a hash for passwordless users", async () => {
  const client = credentialsWriteClient({ passwordHash: null });

  const result = await changePasswordForUser(
    {
      userId: "user_credentials",
      currentPassword: "",
      newPassword: "new-password",
      confirmPassword: "new-password",
    },
    client,
  );
  assert.equal(result.ok, true);
  assert.equal(client._updates.length, 1);
  assert.equal(client._updates[0].id, "user_credentials");
  assert.equal(
    await comparePassword("new-password", client._updates[0].passwordHash),
    true,
  );
});
