import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";

import { installCollabServerShutdown } from "./collab-graceful-shutdown.mjs";

const originalConsole = {
  info: console.info,
  error: console.error,
};

afterEach(() => {
  console.info = originalConsole.info;
  console.error = originalConsole.error;
});

function fakeProcess() {
  const target = new EventEmitter();
  target.exitCode = undefined;
  return target;
}

test("graceful shutdown drains collaboration before closing inline HTTP and Next", async () => {
  console.info = () => {};
  const order = [];
  const processTarget = fakeProcess();
  const server = {
    listening: true,
    close(callback) {
      order.push("http");
      this.listening = false;
      callback();
    },
  };
  const controller = installCollabServerShutdown({
    server,
    closeCollaboration: async () => order.push("collaboration"),
    closeApplication: async () => order.push("application"),
    runtimeMode: "inline",
    processTarget,
  });

  processTarget.emit("SIGTERM");
  const firstShutdown = controller.shutdown("SIGTERM");
  assert.strictEqual(controller.shutdown("SIGINT"), firstShutdown);
  assert.deepEqual(await firstShutdown, { ok: true });
  assert.deepEqual(order, ["collaboration", "http", "application"]);
  assert.equal(processTarget.exitCode, undefined);

  controller.dispose();
  assert.equal(processTarget.listenerCount("SIGINT"), 0);
  assert.equal(processTarget.listenerCount("SIGTERM"), 0);
});

test("graceful shutdown records failure but still closes every runtime layer", async () => {
  console.info = () => {};
  console.error = () => {};
  const order = [];
  const processTarget = fakeProcess();
  const controller = installCollabServerShutdown({
    server: {
      listening: true,
      close(callback) {
        order.push("http");
        callback();
      },
    },
    closeCollaboration: async () => {
      order.push("collaboration");
      throw new Error("flush failed");
    },
    closeApplication: async () => order.push("application"),
    runtimeMode: "inline",
    processTarget,
  });

  assert.deepEqual(await controller.shutdown("SIGTERM"), { ok: false });
  assert.deepEqual(order, ["collaboration", "http", "application"]);
  assert.equal(processTarget.exitCode, 1);
  controller.dispose();
});

test("graceful shutdown propagates HTTP close errors to the process result", async () => {
  console.info = () => {};
  console.error = () => {};
  let applicationClosed = false;
  const processTarget = fakeProcess();
  const controller = installCollabServerShutdown({
    server: {
      listening: true,
      close(callback) {
        callback(new Error("http close failed"));
      },
    },
    closeCollaboration: async () => {},
    closeApplication: async () => {
      applicationClosed = true;
    },
    runtimeMode: "inline",
    processTarget,
  });

  assert.deepEqual(await controller.shutdown("SIGTERM"), { ok: false });
  assert.equal(applicationClosed, true);
  assert.equal(processTarget.exitCode, 1);
  controller.dispose();
});

test("graceful shutdown force-closes HTTP connections after the deadline", async () => {
  console.info = () => {};
  let forced = 0;
  const processTarget = fakeProcess();
  const controller = installCollabServerShutdown({
    server: {
      listening: true,
      close() {},
      closeAllConnections() {
        forced += 1;
      },
    },
    closeCollaboration: async () => {},
    runtimeMode: "standalone",
    processTarget,
    httpShutdownTimeoutMs: 5,
  });

  assert.deepEqual(await controller.shutdown("SIGINT"), { ok: true });
  assert.equal(forced, 1);
  controller.dispose();
});
