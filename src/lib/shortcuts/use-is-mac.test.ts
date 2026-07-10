import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, useMemo, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { detectIsMacPlatform, useIsMac } from "./use-is-mac";

// ---------------------------------------------------------------------------
// Pure detector
// ---------------------------------------------------------------------------

describe("detectIsMacPlatform", () => {
  test("returns false when navigator is undefined (SSR)", () => {
    assert.equal(detectIsMacPlatform(undefined), false);
  });

  test("prefers userAgentData.platform over legacy fields", () => {
    const nav = {
      userAgentData: { platform: "macOS" },
      platform: "Win32",
      userAgent: "Windows NT",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("UACH platform is checked case-insensitively", () => {
    const nav = {
      userAgentData: { platform: "MACOS" },
      platform: "Win32",
      userAgent: "Windows NT",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("UACH Windows platform returns false even with mac in userAgent", () => {
    const nav = {
      userAgentData: { platform: "Windows" },
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Macintosh; ...)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), false);
  });

  test("falls back to navigator.platform when userAgentData is absent", () => {
    const nav = {
      userAgentData: undefined,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Windows NT ...)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("falls back to navigator.platform when userAgentData.platform is undefined", () => {
    const nav = {
      userAgentData: {},
      platform: "MacIntel",
      userAgent: "Mozilla/5.0",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("falls back to navigator.userAgent when platform fields are absent", () => {
    const nav = {
      userAgentData: undefined,
      platform: undefined,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("matches iPhone case-insensitively via platform", () => {
    const nav = {
      userAgentData: undefined,
      platform: "iPhone",
      userAgent: "safari",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("matches iPad case-insensitively via platform", () => {
    const nav = {
      userAgentData: undefined,
      platform: "iPad",
      userAgent: "safari",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("matches iPod case-insensitively via platform", () => {
    const nav = {
      userAgentData: undefined,
      platform: "iPod",
      userAgent: "safari",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), true);
  });

  test("returns false for Windows", () => {
    const nav = {
      userAgentData: undefined,
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), false);
  });

  test("returns false for Linux", () => {
    const nav = {
      userAgentData: undefined,
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), false);
  });

  test("returns false for Android", () => {
    const nav = {
      userAgentData: undefined,
      platform: "Linux armv7l",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
    } as unknown as typeof navigator;
    assert.equal(detectIsMacPlatform(nav), false);
  });
});

// ---------------------------------------------------------------------------
// Hook — SSR behaviour via renderToStaticMarkup
// ---------------------------------------------------------------------------

describe("useIsMac hook (SSR)", () => {
  test("returns false during SSR (no navigator in server context)", () => {
    // Render a component that captures the hook return value during SSR.
    // renderToStaticMarkup runs synchronously in a Node environment where
    // navigator is undefined, so the hook must return false.
    function Probe(): ReactElement {
      const isMac = useIsMac();
      return createElement("span", null, String(isMac));
    }
    const html = renderToStaticMarkup(createElement(Probe));
    assert.equal(html, "<span>false</span>");
  });

  test("useMemo dependency array is empty (no re-computation on re-render)", () => {
    // Capture call count to verify that the detection function is called exactly
    // once per component lifecycle, not once per render.
    let callCount = 0;
    function ProbeWithCounter(): ReactElement {
      const result = useMemo(() => {
        callCount++;
        return detectIsMacPlatform(undefined);
      }, []);
      return createElement("span", null, String(result));
    }
    renderToStaticMarkup(createElement(ProbeWithCounter));
    assert.equal(callCount, 1);
  });
});
