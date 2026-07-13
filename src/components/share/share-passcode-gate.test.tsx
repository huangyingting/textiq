/**
 * Direct contract coverage for `SharePasscodeGate` (#1945).
 *
 * `SharePasscodeGate` is a plain (hookless) function component, so it can be
 * rendered directly with `renderToStaticMarkup` without any module-hook or
 * harness scaffolding. These tests assert the unlock form's hidden field
 * wiring (shareId/mode/returnTo passed straight to the POST target), the
 * passcode input's length constraints sourced from `@/lib/share-passcode`,
 * and the "invalid"/"limited" error-message gating (including the no-error
 * default render).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MAX_SHARE_PASSCODE_LENGTH,
  MIN_SHARE_PASSCODE_LENGTH,
} from "@/lib/share-passcode";

import { SharePasscodeGate } from "./share-passcode-gate";

describe("SharePasscodeGate", () => {
  test("renders the unlock form action/method and hidden shareId/mode/returnTo fields", () => {
    const html = renderToStaticMarkup(
      <SharePasscodeGate
        shareId="share-abc123"
        mode="embed"
        returnTo="/embed/share-abc123"
      />,
    );

    assert.match(html, /action="\/api\/share-passcode\/unlock"/);
    assert.match(html, /method="post"/);
    assert.match(html, /<input[^>]*name="shareId"[^>]*value="share-abc123"/);
    assert.match(html, /<input[^>]*name="mode"[^>]*value="embed"/);
    assert.match(
      html,
      /<input[^>]*name="returnTo"[^>]*value="\/embed\/share-abc123"/,
    );
  });

  test("wires the passcode input's min/max length from the shared share-passcode constants", () => {
    const html = renderToStaticMarkup(
      <SharePasscodeGate
        shareId="share-1"
        mode="view"
        returnTo="/share/share-1"
      />,
    );

    const passcodeInputMatch = html.match(/<input[^>]*name="passcode"[^>]*\/>/);
    assert.ok(passcodeInputMatch, "expected a passcode <input> element");
    const passcodeInput = passcodeInputMatch[0];
    assert.match(
      passcodeInput,
      new RegExp(`minLength="${MIN_SHARE_PASSCODE_LENGTH}"`),
    );
    assert.match(
      passcodeInput,
      new RegExp(`maxLength="${MAX_SHARE_PASSCODE_LENGTH}"`),
    );
    assert.match(passcodeInput, /required=""/);
    assert.match(passcodeInput, /type="password"/);
  });

  test("omits the alert message entirely when no error is supplied", () => {
    const html = renderToStaticMarkup(
      <SharePasscodeGate
        shareId="share-1"
        mode="present"
        returnTo="/present/share-1"
      />,
    );

    assert.doesNotMatch(html, /role="alert"/);
  });

  test("shows the incorrect-passcode message for an 'invalid' error", () => {
    const html = renderToStaticMarkup(
      <SharePasscodeGate
        shareId="share-1"
        mode="view"
        returnTo="/share/share-1"
        error="invalid"
      />,
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Incorrect passcode\. Please try again\./);
    assert.doesNotMatch(html, /Too many attempts/);
  });

  test("shows the rate-limit message for a 'limited' error", () => {
    const html = renderToStaticMarkup(
      <SharePasscodeGate
        shareId="share-1"
        mode="view"
        returnTo="/share/share-1"
        error="limited"
      />,
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Too many attempts\. Please wait and try again\./);
    assert.doesNotMatch(html, /Incorrect passcode/);
  });
});
