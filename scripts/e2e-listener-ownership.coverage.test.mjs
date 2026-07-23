import assert from "node:assert/strict";
import test from "node:test";

import {
  assertE2EConnectionOwnedByProcess,
  assertE2EListenerOwnedByProcess,
  linuxProcessTreePids,
  waitForOwnedE2EConnection,
  waitForOwnedE2EListener,
} from "./e2e-listener-ownership.mjs";

const TCP_HEADER =
  "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode";

function endpoint(port) {
  return `0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`;
}

function listenerTable(port, inode = "12345", state = "0A") {
  return `${TCP_HEADER}\n0: ${endpoint(port)} 00000000:0000 ${state} 0 0 0 0 0 ${inode}\n`;
}

function connectionTable(
  serverPort,
  clientPort,
  inode = "12345",
  state = "01",
) {
  return `${TCP_HEADER}\n0: ${endpoint(serverPort)} ${endpoint(clientPort)} ${state} 0 0 0 0 0 ${inode}\n`;
}

test("listener ownership validates Linux loopback listeners and failure modes", async () => {
  const readFile = (path) => {
    if (path === "/proc/net/tcp") return listenerTable(4000);
    if (path === "/proc/1/task/1/children") return "2\n";
    if (path === "/proc/2/task/2/children") return "";
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  const verified = assertE2EListenerOwnedByProcess({
    host: "127.0.0.1",
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile,
    readDirectory: (path) => (path.includes("/1/") ? ["3"] : ["4"]),
    readLink: (path) => (path.endsWith("/3") ? "socket:[12345]" : "pipe:[1]"),
  });
  assert.deepEqual(verified.ownerPids, [1]);
  assert.deepEqual(verified.processTreePids, [1, 2]);

  assert.throws(() =>
    assertE2EListenerOwnedByProcess({ host: "localhost", platform: "linux" }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({ host: "127.0.0.1", platform: "darwin" }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 0,
      pid: 1,
      platform: "linux",
    }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => {
        throw new Error("proc denied");
      },
    }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => listenerTable(4001),
      readDirectory: () => ["3"],
      readLink: () => "socket:[12345]",
    }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => listenerTable(4000, "999"),
      readDirectory: (path) => {
        if (path.includes("/1/")) return ["3"];
        throw new Error("child denied");
      },
      readLink: () => "socket:[12345]",
    }),
  );
  assert.throws(() =>
    assertE2EListenerOwnedByProcess({
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => listenerTable(4000, "999"),
      readDirectory: () => ["3"],
      readLink: () => "socket:[12345]",
    }),
  );

  let attempts = 0;
  assert.deepEqual(
    await waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_LISTENER_NOT_READY";
          throw error;
        }
        return { ok: true };
      },
    }),
    { ok: true },
  );
  let defaultListenerDelayAttempts = 0;
  assert.deepEqual(
    await waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 50,
      verify: () => {
        defaultListenerDelayAttempts += 1;
        if (defaultListenerDelayAttempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_LISTENER_NOT_READY";
          throw error;
        }
        return { delayed: true };
      },
    }),
    { delayed: true },
  );

  await assert.rejects(
    waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        throw new Error("fatal listener");
      },
    }),
    /fatal listener/,
  );
  await assert.rejects(
    waitForOwnedE2EListener({
      host: "127.0.0.1",
      port: 4000,
      timeoutMs: 0,
      delay: async () => {},
      verify: () => {
        const error = new Error("not ready");
        error.code = "E2E_LISTENER_NOT_READY";
        throw error;
      },
    }),
    /did not own/,
  );
});

test("connection ownership validates accepted sockets, owners, and retry paths", async () => {
  const verified = assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: (path) => {
      if (path === "/proc/net/tcp") return connectionTable(4000, 5000);
      if (path.endsWith("/children")) return "";
      throw new Error("unexpected");
    },
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });
  assert.deepEqual(verified.ownerPids, [1]);

  assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    includeDescendants: false,
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: () => connectionTable(4000, 5000),
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });
  assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    ownerPids: [9],
    port: 4000,
    pid: 1,
    platform: "linux",
    readFile: () => connectionTable(4000, 5000),
    readDirectory: () => ["3"],
    readLink: () => "socket:[12345]",
  });

  for (const options of [
    { host: "localhost", platform: "linux" },
    { host: "127.0.0.1", platform: "darwin" },
    { host: "127.0.0.1", platform: "linux", port: 0 },
  ]) {
    assert.throws(() => assertE2EConnectionOwnedByProcess(options));
  }
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => {
        throw new Error("proc denied");
      },
    }),
  );
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => connectionTable(4001, 5000),
      readDirectory: () => ["3"],
      readLink: () => "socket:[12345]",
    }),
  );
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => connectionTable(4000, 5000, "999"),
      readDirectory: () => {
        throw new Error("denied");
      },
    }),
  );
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => connectionTable(4000, 5000, "999"),
      readDirectory: () => ["3"],
      readLink: () => "socket:[12345]",
    }),
  );
  assert.throws(() =>
    assertE2EConnectionOwnedByProcess({
      clientPort: 5000,
      host: "127.0.0.1",
      port: 4000,
      pid: 1,
      platform: "linux",
      readFile: () => connectionTable(4000, 5000, "999"),
      readDirectory: () => ["3"],
      readLink: () => {
        throw "non-error";
      },
    }),
  );

  let attempts = 0;
  assert.deepEqual(
    await waitForOwnedE2EConnection({
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_CONNECTION_NOT_READY";
          throw error;
        }
        return { ok: true };
      },
    }),
    { ok: true },
  );
  let defaultConnectionDelayAttempts = 0;
  assert.deepEqual(
    await waitForOwnedE2EConnection({
      timeoutMs: 50,
      verify: () => {
        defaultConnectionDelayAttempts += 1;
        if (defaultConnectionDelayAttempts === 1) {
          const error = new Error("not ready");
          error.code = "E2E_CONNECTION_NOT_READY";
          throw error;
        }
        return { delayed: true };
      },
    }),
    { delayed: true },
  );

  await assert.rejects(
    waitForOwnedE2EConnection({
      timeoutMs: 0,
      delay: async () => {},
      verify: () => {
        const error = new Error("not ready");
        error.code = "E2E_CONNECTION_NOT_READY";
        throw error;
      },
    }),
    /could not be attributed/,
  );
  await assert.rejects(
    waitForOwnedE2EConnection({
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        throw new Error("fatal");
      },
    }),
    /fatal/,
  );

  assert.deepEqual(
    linuxProcessTreePids(1, {
      readFile: (path) => (path.includes("/1/") ? "2 bad 3" : ""),
    }),
    [1, 2, 3],
  );
  assert.deepEqual(
    linuxProcessTreePids(1, {
      readFile: (path) => {
        if (path.includes("/1/")) return "2";
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      },
    }),
    [1, 2],
  );
  assert.throws(() =>
    linuxProcessTreePids(1, {
      readFile: () => {
        throw new Error("denied");
      },
    }),
  );
});

test("connection ownership: inspection errors during fd scan are E2E_CONNECTION_NOT_READY (transient retry)", async () => {
  // --- prove: transient inconclusive state retries ---

  // Child PID 2 is dying (ENOENT on fd read); connection inode 999 is not yet
  // in any live fd (still in kernel accept backlog).  This must be retryable.
  assert.throws(
    () =>
      assertE2EConnectionOwnedByProcess({
        clientPort: 5000,
        host: "127.0.0.1",
        port: 4000,
        pid: 1,
        platform: "linux",
        ownerPids: [1, 2],
        readFile: () => connectionTable(4000, 5000, "999"),
        readDirectory: (path) => {
          if (path === "/proc/1/fd") return ["3"];
          throw Object.assign(new Error("child gone"), { code: "ENOENT" });
        },
        readLink: () => "socket:[12345]",
      }),
    (err) => {
      assert.equal(
        err.code,
        "E2E_CONNECTION_NOT_READY",
        "inspection-error state must be E2E_CONNECTION_NOT_READY so waitForOwnedE2EConnection retries",
      );
      assert.match(err.message, /Unable to prove/);
      return true;
    },
  );

  // Non-ENOENT child inspection error is also inconclusive, not fatal.
  assert.throws(
    () =>
      assertE2EConnectionOwnedByProcess({
        clientPort: 5000,
        host: "127.0.0.1",
        port: 4000,
        pid: 1,
        platform: "linux",
        ownerPids: [1, 2],
        readFile: () => connectionTable(4000, 5000, "999"),
        readDirectory: (path) => {
          if (path === "/proc/1/fd") return ["3"];
          throw new Error("transient read error");
        },
        readLink: () => "socket:[12345]",
      }),
    (err) => {
      assert.equal(err.code, "E2E_CONNECTION_NOT_READY");
      return true;
    },
  );

  // --- prove: verified intended ownership succeeds ---

  // On the next attempt after a transient gap, child 2 has accepted and
  // the inode appears in its fd table.
  const verified = assertE2EConnectionOwnedByProcess({
    clientPort: 5000,
    host: "127.0.0.1",
    port: 4000,
    pid: 1,
    platform: "linux",
    ownerPids: [1, 2],
    readFile: () => connectionTable(4000, 5000, "999"),
    readDirectory: (path) => {
      if (path === "/proc/2/fd") return ["7"];
      return [];
    },
    readLink: (path) => (path === "/proc/2/fd/7" ? "socket:[999]" : "pipe:[1]"),
  });
  assert.deepEqual(verified.ownerPids, [2]);
  assert.deepEqual(verified.inodes, ["999"]);

  // --- prove: waitForOwnedE2EConnection retries inspection-error case ---

  let callCount = 0;
  const retryResult = await waitForOwnedE2EConnection({
    timeoutMs: 200,
    delay: async () => {},
    verify: () => {
      callCount += 1;
      if (callCount === 1) {
        const err = new Error(
          "Unable to prove accepted E2E connection ownership; refusing credentials.",
        );
        err.code = "E2E_CONNECTION_NOT_READY";
        throw err;
      }
      return { attributed: true };
    },
  });
  assert.deepEqual(retryResult, { attributed: true });
  assert.ok(callCount >= 2, "must have retried at least once");

  // --- prove: a foreign/mismatched owner still fails ---

  // No inspection errors, confirmed foreign inode: the error uses
  // E2E_CONNECTION_NOT_READY (backlog state) but repeated retries never
  // resolve — bounded by timeout.
  await assert.rejects(
    waitForOwnedE2EConnection({
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        // Inspection succeeds but inode is genuinely foreign — never resolves.
        const err = new Error(
          "The accepted E2E connection inodes 999 are not owned by checked PIDs 1; refusing credentials.",
        );
        err.code = "E2E_CONNECTION_NOT_READY";
        throw err;
      },
    }),
    /could not be attributed/,
  );

  // --- prove: retry remains bounded ---

  let inspectionErrorCalls = 0;
  await assert.rejects(
    waitForOwnedE2EConnection({
      timeoutMs: 50,
      delay: async () => {},
      verify: () => {
        inspectionErrorCalls += 1;
        const err = new Error(
          "Unable to prove accepted E2E connection ownership; refusing credentials.",
        );
        err.code = "E2E_CONNECTION_NOT_READY";
        throw err;
      },
    }),
    /could not be attributed/,
  );
  assert.ok(
    inspectionErrorCalls > 1,
    "must have retried before timing out (not a one-shot failure)",
  );
});
