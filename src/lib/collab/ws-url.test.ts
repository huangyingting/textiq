import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveCollabWsUrl } from "./ws-url";

const MANAGED_ENV_VARS = [
  "NEXT_PUBLIC_COLLAB_WS_URL",
  "NEXT_PUBLIC_COLLAB_WS_PORT",
] as const;

const savedEnv: Record<string, string | undefined> = {};
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
  for (const name of MANAGED_ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  Reflect.deleteProperty(globalThis, "window");
});

afterEach(() => {
  for (const name of MANAGED_ENV_VARS) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
  if (savedWindow) {
    Object.defineProperty(globalThis, "window", savedWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function setWindowLocation(protocol: string, host: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { protocol, host } },
  });
}

describe("resolveCollabWsUrl", () => {
  it("explicit override always wins, even when a browser window is present", () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = "wss://explicit.example/collab";
    setWindowLocation("https:", "app.example.com");

    assert.equal(resolveCollabWsUrl(), "wss://explicit.example/collab");
  });

  it("explicit override wins over the SSR fallback too", () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = "ws://collab.internal:9000/collab";

    assert.equal(resolveCollabWsUrl(), "ws://collab.internal:9000/collab");
  });

  it("browser http:// origin mirrors to ws:// and appends /collab", () => {
    setWindowLocation("http:", "localhost:3000");

    assert.equal(resolveCollabWsUrl(), "ws://localhost:3000/collab");
  });

  it("browser https:// origin mirrors to wss:// and appends /collab", () => {
    setWindowLocation("https:", "app.example.com");

    assert.equal(resolveCollabWsUrl(), "wss://app.example.com/collab");
  });

  it("browser origin with a non-default port is preserved verbatim", () => {
    setWindowLocation("https:", "app.example.com:8443");

    assert.equal(resolveCollabWsUrl(), "wss://app.example.com:8443/collab");
  });

  it("SSR (no window global) falls back to ws://localhost:<default port>/collab", () => {
    assert.equal(resolveCollabWsUrl(), "ws://localhost:4000/collab");
  });

  it("SSR fallback honors an explicit NEXT_PUBLIC_COLLAB_WS_PORT", () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_PORT = "5001";

    assert.equal(resolveCollabWsUrl(), "ws://localhost:5001/collab");
  });

  it("window without a location object is treated as the SSR fallback", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    assert.equal(resolveCollabWsUrl(), "ws://localhost:4000/collab");
  });

  it("an empty explicit override is falsy and falls through to the browser origin", () => {
    process.env.NEXT_PUBLIC_COLLAB_WS_URL = "";
    setWindowLocation("http:", "localhost:3000");

    assert.equal(resolveCollabWsUrl(), "ws://localhost:3000/collab");
  });

  it("never appends a room segment; callers append their own room path", () => {
    setWindowLocation("https:", "app.example.com");

    assert.doesNotMatch(resolveCollabWsUrl(), /\/collab\/.+$/);
  });
});
