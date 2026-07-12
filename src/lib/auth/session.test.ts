import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { requireUserCore, type CurrentUser } from "@/lib/session";

function redirectRecorder() {
  const calls: string[] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(url);
      throw new Error(`redirect:${url}`);
    },
  };
}

describe("requireUserCore", () => {
  test("redirects anonymous sessions to login before querying users", async () => {
    const redirects = redirectRecorder();
    let queried = false;

    await assert.rejects(
      requireUserCore(
        {
          async getSessionUser() {
            return null;
          },
          async findUserById() {
            queried = true;
            return { id: "unused", sessionInvalidatedAt: null };
          },
        },
        redirects.redirect,
      ),
      /redirect:\/login/,
    );

    assert.deepEqual(redirects.calls, ["/login"]);
    assert.equal(queried, false);
  });

  test("redirects stale sessions to signout when the user row is gone", async () => {
    const redirects = redirectRecorder();

    await assert.rejects(
      requireUserCore(
        {
          async getSessionUser() {
            return { id: "user-missing" } as CurrentUser;
          },
          async findUserById(id) {
            assert.equal(id, "user-missing");
            return null;
          },
        },
        redirects.redirect,
      ),
      /redirect:\/signout/,
    );

    assert.deepEqual(redirects.calls, ["/signout"]);
  });

  test("redirects stale sessions to signout when credentials rotated", async () => {
    const redirects = redirectRecorder();
    const user = {
      id: "user-1",
      email: "ada@example.test",
      sessionInvalidatedAt: "2026-07-04T20:00:00.000Z",
    } as CurrentUser;

    await assert.rejects(
      requireUserCore(
        {
          async getSessionUser() {
            return user;
          },
          async findUserById(id) {
            assert.equal(id, "user-1");
            return {
              id,
              sessionInvalidatedAt: new Date("2026-07-04T21:00:00.000Z"),
            };
          },
        },
        redirects.redirect,
      ),
      /redirect:\/signout/,
    );

    assert.deepEqual(redirects.calls, ["/signout"]);
  });

  test("returns the session user when the backing user row and stamp are current", async () => {
    const stamp = "2026-07-04T21:00:00.000Z";
    const user = {
      id: "user-1",
      email: "ada@example.test",
      sessionInvalidatedAt: stamp,
    } as CurrentUser;
    const redirects = redirectRecorder();

    const result = await requireUserCore(
      {
        async getSessionUser() {
          return user;
        },
        async findUserById(id) {
          assert.equal(id, "user-1");
          return { id, sessionInvalidatedAt: new Date(stamp) };
        },
      },
      redirects.redirect,
    );

    assert.equal(result, user);
    assert.deepEqual(redirects.calls, []);
  });

  test("returns the session user when neither the token nor the row ever set a security stamp", async () => {
    const user = {
      id: "user-1",
      email: "ada@example.test",
      sessionInvalidatedAt: null,
    } as CurrentUser;
    const redirects = redirectRecorder();

    const result = await requireUserCore(
      {
        async getSessionUser() {
          return user;
        },
        async findUserById(id) {
          assert.equal(id, "user-1");
          return { id, sessionInvalidatedAt: null };
        },
      },
      redirects.redirect,
    );

    assert.equal(result, user);
    assert.deepEqual(redirects.calls, []);
  });
});
