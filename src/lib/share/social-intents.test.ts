import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canCopyImageToClipboard,
  canWebShare,
  buildTwitterIntent,
  buildLinkedInIntent,
  buildFacebookIntent,
} from "@/lib/share/social-intents";

function replaceGlobal(
  t: { after(callback: () => void): void },
  key: string,
  value: unknown,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const setValue = (nextValue: unknown) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: nextValue,
    });
  };
  setValue(value);
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  });
  return setValue;
}

// ---------------------------------------------------------------------------
// buildTwitterIntent
// ---------------------------------------------------------------------------

describe("buildTwitterIntent", () => {
  test("produces a twitter.com/intent/tweet URL", () => {
    const url = buildTwitterIntent("https://example.com", "Hello world");
    assert.ok(
      url.startsWith("https://twitter.com/intent/tweet"),
      `expected twitter intent prefix, got: ${url}`,
    );
  });

  test("encodes the url parameter", () => {
    const shareUrl = "https://example.com/share/my-doc-abc123";
    const result = buildTwitterIntent(shareUrl, "Hello");
    assert.ok(
      result.includes("url=" + encodeURIComponent(shareUrl)),
      `expected encoded url param in: ${result}`,
    );
  });

  test("encodes the text parameter", () => {
    const text = "Check out my visual: diagrams & charts!";
    const result = buildTwitterIntent("https://example.com", text);
    assert.ok(
      result.includes("text=" + encodeURIComponent(text)),
      `expected encoded text param in: ${result}`,
    );
  });

  test("encodes special characters in url", () => {
    const specialUrl = "https://example.com/share/a b+c=d&e";
    const result = buildTwitterIntent(specialUrl, "test");
    // The raw special characters must not appear verbatim in the query string
    assert.ok(!result.includes(" "), "spaces must be encoded");
  });

  test("encodes special characters in text", () => {
    const text = "Title with spaces & symbols #textiq";
    const result = buildTwitterIntent("https://example.com", text);
    assert.ok(!result.includes(" "), "spaces in text must be encoded");
    assert.ok(!result.includes("#"), "hash in text must be encoded");
    // The & from the text must appear as %26 in the raw URL string (not as a
    // bare & which would be misinterpreted as a query param separator).
    assert.ok(
      result.includes("%26"),
      "ampersand in text must be percent-encoded as %26 in raw URL",
    );
  });

  test("includes both url and text params", () => {
    const result = buildTwitterIntent(
      "https://example.com",
      "Sharing a visual",
    );
    assert.ok(result.includes("url="), "must include url param");
    assert.ok(result.includes("text="), "must include text param");
  });

  test("handles empty text", () => {
    const result = buildTwitterIntent("https://example.com", "");
    assert.ok(
      result.includes("text="),
      "must include text param even when empty",
    );
  });
});

// ---------------------------------------------------------------------------
// buildLinkedInIntent
// ---------------------------------------------------------------------------

describe("buildLinkedInIntent", () => {
  test("produces a linkedin.com sharing URL", () => {
    const result = buildLinkedInIntent("https://example.com");
    assert.ok(
      result.startsWith("https://www.linkedin.com/sharing/share-offsite/"),
      `expected LinkedIn share prefix, got: ${result}`,
    );
  });

  test("encodes the url parameter", () => {
    const shareUrl = "https://example.com/share/my-doc-abc123";
    const result = buildLinkedInIntent(shareUrl);
    assert.ok(
      result.includes("url=" + encodeURIComponent(shareUrl)),
      `expected encoded url param in: ${result}`,
    );
  });

  test("encodes special characters", () => {
    const shareUrl = "https://example.com/share/a b+c=d";
    const result = buildLinkedInIntent(shareUrl);
    assert.ok(!result.includes(" "), "spaces must be encoded");
  });

  test("URL structure is correct", () => {
    const result = buildLinkedInIntent("https://textiq.example.com/share/abc");
    const parsed = new URL(result);
    assert.equal(parsed.hostname, "www.linkedin.com");
    assert.equal(parsed.pathname, "/sharing/share-offsite/");
    assert.ok(parsed.searchParams.has("url"), "must have url param");
  });
});

// ---------------------------------------------------------------------------
// buildFacebookIntent
// ---------------------------------------------------------------------------

describe("buildFacebookIntent", () => {
  test("produces a facebook.com/sharer URL", () => {
    const result = buildFacebookIntent("https://example.com");
    assert.ok(
      result.startsWith("https://www.facebook.com/sharer/sharer.php"),
      `expected Facebook sharer prefix, got: ${result}`,
    );
  });

  test("encodes the u parameter", () => {
    const shareUrl = "https://example.com/share/my-doc-abc123";
    const result = buildFacebookIntent(shareUrl);
    assert.ok(
      result.includes("u=" + encodeURIComponent(shareUrl)),
      `expected encoded u param in: ${result}`,
    );
  });

  test("encodes special characters", () => {
    const shareUrl = "https://example.com/share/a b+c=d";
    const result = buildFacebookIntent(shareUrl);
    assert.ok(!result.includes(" "), "spaces must be encoded");
  });

  test("URL structure is correct", () => {
    const result = buildFacebookIntent("https://textiq.example.com/share/abc");
    const parsed = new URL(result);
    assert.equal(parsed.hostname, "www.facebook.com");
    assert.equal(parsed.pathname, "/sharer/sharer.php");
    assert.ok(parsed.searchParams.has("u"), "must have u param");
  });
});

// ---------------------------------------------------------------------------
// Round-trip: encoded URLs can be decoded back
// ---------------------------------------------------------------------------

describe("intent URL encoding round-trips", () => {
  const SHARE_URL = "https://textiq.example.com/share/my-visual-abc123xyz";
  const TITLE = "My Diagram — Q4 Roadmap (2026) & Beyond";

  test("Twitter: decoded params match original values", () => {
    const intent = buildTwitterIntent(SHARE_URL, TITLE);
    const parsed = new URL(intent);
    assert.equal(
      parsed.searchParams.get("url"),
      SHARE_URL,
      "url param should round-trip",
    );
    assert.equal(
      parsed.searchParams.get("text"),
      TITLE,
      "text param should round-trip",
    );
  });

  test("LinkedIn: decoded param matches original URL", () => {
    const intent = buildLinkedInIntent(SHARE_URL);
    const parsed = new URL(intent);
    assert.equal(
      parsed.searchParams.get("url"),
      SHARE_URL,
      "url param should round-trip",
    );
  });

  test("Facebook: decoded param matches original URL", () => {
    const intent = buildFacebookIntent(SHARE_URL);
    const parsed = new URL(intent);
    assert.equal(
      parsed.searchParams.get("u"),
      SHARE_URL,
      "u param should round-trip",
    );
  });
});

describe("browser sharing capability detection", () => {
  test("canWebShare returns false when navigator or share support is missing", (t) => {
    const setNavigator = replaceGlobal(t, "navigator", undefined);
    assert.equal(canWebShare(), false);

    setNavigator({});
    assert.equal(canWebShare(), false);
  });

  test("canWebShare returns true for basic Web Share support", (t) => {
    replaceGlobal(t, "navigator", { share() {} });

    assert.equal(canWebShare(), true);
  });

  test("canWebShare delegates file payload checks to navigator.canShare", (t) => {
    const file = new File(["diagram"], "diagram.png", { type: "image/png" });
    const calls: unknown[] = [];
    replaceGlobal(t, "navigator", {
      share() {},
      canShare(payload: unknown) {
        calls.push(payload);
        return true;
      },
    });

    assert.equal(canWebShare(file), true);
    assert.deepEqual(calls, [{ files: [file] }]);
  });

  test("canWebShare returns false when canShare rejects a file payload", (t) => {
    const file = new File(["diagram"], "diagram.png", { type: "image/png" });
    replaceGlobal(t, "navigator", {
      share() {},
      canShare(payload: unknown) {
        assert.deepEqual(payload, { files: [file] });
        return false;
      },
    });

    assert.equal(canWebShare(file), false);
  });

  test("canWebShare allows file payloads when canShare is unavailable", (t) => {
    const file = new File(["diagram"], "diagram.png", { type: "image/png" });
    replaceGlobal(t, "navigator", { share() {} });

    assert.equal(canWebShare(file), true);
  });

  test("canWebShare treats canShare exceptions as unsupported", (t) => {
    const file = new File(["diagram"], "diagram.png", { type: "image/png" });
    replaceGlobal(t, "navigator", {
      share() {},
      canShare() {
        throw new Error("unsupported payload");
      },
    });

    assert.equal(canWebShare(file), false);
  });

  test("canCopyImageToClipboard requires navigator clipboard write and ClipboardItem", (t) => {
    const setNavigator = replaceGlobal(t, "navigator", {
      clipboard: { write() {} },
    });
    const setClipboardItem = replaceGlobal(
      t,
      "ClipboardItem",
      class ClipboardItem {},
    );
    assert.equal(canCopyImageToClipboard(), true);

    setClipboardItem(undefined);
    assert.equal(canCopyImageToClipboard(), false);

    setNavigator({ clipboard: null });
    assert.equal(canCopyImageToClipboard(), false);
  });

  test("canCopyImageToClipboard returns false when clipboard write is missing", (t) => {
    replaceGlobal(t, "navigator", {
      clipboard: {},
    });
    replaceGlobal(t, "ClipboardItem", class ClipboardItem {});

    assert.equal(canCopyImageToClipboard(), false);
  });
});
