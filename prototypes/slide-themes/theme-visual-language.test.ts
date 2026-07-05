import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SEMANTIC_TEMPLATE_KINDS } from "@/lib/presentation/template-registry";
import { validateThemePackage } from "@/lib/presentation/theme-package-schema";
import { safeParseDeck } from "@/lib/presentation/validation";

function readDeck(id: string) {
  const parsed = safeParseDeck(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `prototypes/slide-themes/decks/${id}.deck.json`),
        "utf8",
      ),
    ),
  );
  if (!parsed.success) {
    assert.fail(parsed.errors.join("; "));
  }
  assert.ok(parsed.success);
  return parsed.data;
}

function readPackage(id: string) {
  const parsed = validateThemePackage(
    JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          `prototypes/slide-themes/packages/${id}.package.json`,
        ),
        "utf8",
      ),
    ),
  );
  if (!parsed.valid) {
    assert.fail(
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
    );
  }
  assert.ok(parsed.valid);
  return parsed.package;
}

function readPackageFixture(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        `prototypes/slide-themes/packages/${id}.package.json`,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

test("native presentation packages materialize every semantic template into preview decks", () => {
  for (const id of [
    "clarity",
    "ocean",
    "aurora",
    "monolith",
    "editorial",
    "noir",
    "terra",
    "pulse",
  ]) {
    const themePackage = readPackage(id);
    const deck = readDeck(id);
    assert.equal(themePackage.schemaVersion, 1, id);
    assert.equal(deck.schemaVersion, 7, id);
    assert.equal(deck.theme.packageId, id);
    assert.equal(deck.slides.length, SEMANTIC_TEMPLATE_KINDS.length, id);

    for (const kind of SEMANTIC_TEMPLATE_KINDS) {
      const slide = deck.slides.find(
        (candidate) => candidate.template.kind === kind,
      );
      assert.ok(slide, `${id}:${kind}`);
      assert.ok(slide.children.length > 0, `${id}:${kind} has children`);
      assert.equal(
        slide.children.some((child) => child.type === "text"),
        true,
        `${id}:${kind} has text nodes`,
      );
    }
  }
});

test("native presentation packages retain distinctive style packages", () => {
  const clarity = readPackage("clarity");
  const ocean = readPackage("ocean");
  const pulse = readPackage("pulse");

  assert.equal(clarity.tokens.colors.accent.fill, "#0042ff");
  assert.ok(clarity.decorations?.grid);

  assert.equal(ocean.tokens.colors.accent.fill, "#7b5cff");
  assert.ok(ocean.decorations?.glow);

  assert.equal(pulse.tokens.fonts.heading.includes("JetBrains Mono"), true);
  assert.ok(pulse.decorations?.scanLine);
});

test("native presentation package fixtures reject malformed assets, decorations, and unknown fields", () => {
  const baseFixture = readPackageFixture("clarity");
  const malformedFixtures: Array<{
    name: string;
    fixture: Record<string, unknown>;
    expectedMessage: string;
  }> = [
    {
      name: "unknown top-level field",
      fixture: {
        ...JSON.parse(JSON.stringify(baseFixture)),
        unexpectedField: true,
      },
      expectedMessage:
        "ThemePackage.unexpectedField is not a known theme package field",
    },
    {
      name: "invalid assets manifest",
      fixture: {
        ...JSON.parse(JSON.stringify(baseFixture)),
        assets: {
          images: {
            "hero-image": {
              id: "hero-image",
              src: "https://example.com/hero.bmp",
              mimeType: "image/bmp",
            },
          },
        },
      },
      expectedMessage: "ThemePackage.assets.images.hero-image.mimeType must be",
    },
    {
      name: "invalid decoration appliesTo contract",
      fixture: {
        ...JSON.parse(JSON.stringify(baseFixture)),
        decorations: {
          invalidDecoration: {
            id: "invalidDecoration",
            component: "text",
            role: "themeDecoration",
            layout: { frame: { x: 0, y: 0, w: 15, h: 15 }, zIndex: 1 },
            style: {},
            content: { type: "text", text: "Invalid fixture decoration" },
            appliesTo: {
              templateKinds: ["not-a-template-kind"],
            },
          },
        },
      },
      expectedMessage:
        "ThemePackage.decorations.invalidDecoration.appliesTo.templateKinds.0 must be one of:",
    },
  ];

  for (const malformed of malformedFixtures) {
    const parsed = validateThemePackage(malformed.fixture);
    assert.equal(parsed.valid, false, malformed.name);
    if (!parsed.valid) {
      assert.ok(
        parsed.diagnostics.some((diagnostic) =>
          diagnostic.message.includes(malformed.expectedMessage),
        ),
        `${malformed.name} diagnostics: ${parsed.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
  }
});
