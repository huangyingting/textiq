import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveNodeFontCss } from "./node-font-css";

describe("resolveNodeFontCss", () => {
  test("maps resolved v7 text style to inline editor CSS", () => {
    assert.deepEqual(
      resolveNodeFontCss({
        text: {
          fontFamily: "Aptos",
          fontSizePt: 24,
          weight: 700,
          italic: true,
          underline: true,
          color: "#123456",
          lineHeight: 1.25,
          align: "center",
          letterSpacingEm: 0.08,
          textTransform: "uppercase",
          verticalAlign: "bottom",
          paragraphSpacingPt: 3,
        },
      }),
      {
        fontFamily: "Aptos",
        fontSize: "24pt",
        fontWeight: 700,
        fontStyle: "italic",
        textDecoration: "underline",
        color: "#123456",
        lineHeight: 1.25,
        textAlign: "center",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        rowGap: "3pt",
      },
    );
  });

  test("combines underline and strikethrough text decorations", () => {
    assert.deepEqual(
      resolveNodeFontCss({
        text: {
          underline: true,
          strikethrough: true,
        },
      }),
      {
        textDecoration: "underline line-through",
      },
    );
  });

  test("returns empty css when text style is absent", () => {
    assert.deepEqual(resolveNodeFontCss(undefined), {});
    assert.deepEqual(resolveNodeFontCss({}), {});
  });
});
