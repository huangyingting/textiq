/**
 * Builds presentation semantic preview decks and presentation theme package JSON artifacts.
 *
 * `theme-packages.ts` is the source of truth. This script does not read or
 * upgrade legacy v6 package JSON; generated decks are native `Deck` payloads.
 *
 * Run from the repo root:
 *   node --import tsx prototypes/slide-themes/build-themes.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  SemanticSlideSpecV1,
  SlotValue,
} from "@/lib/presentation/semantic-deck-plan";
import {
  DECK_SCHEMA_VERSION,
  type Deck,
  type SemanticTemplateKind,
  type SlideNode,
  type SlotKey,
} from "@/lib/presentation/schema";
import {
  compileSlide,
  resetIdCounter,
} from "@/lib/presentation/template-compiler";
import { SEMANTIC_TEMPLATE_KINDS } from "@/lib/presentation/template-registry";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  validateThemePackage,
  type ThemePackageV1,
} from "@/lib/presentation/theme-package-schema";
import { safeParseDeck } from "@/lib/presentation/validation";
import { THEME_PACKAGE_SOURCES } from "./theme-packages";

const here = dirname(fileURLToPath(import.meta.url));
const deckOutDir = join(here, "decks");
const packageOutDir = join(here, "packages");
mkdirSync(deckOutDir, { recursive: true });
mkdirSync(packageOutDir, { recursive: true });

const registry = createDefaultTemplateRegistry();

type ManifestEntry = {
  id: string;
  name: string;
  tagline: string;
  file: string;
  packageFile: string;
  schemaVersion: 7;
  slides: number;
  fonts: { heading: string; body: string };
  accent: string;
  templates: Array<{
    kind: string;
    label: string;
    group: string;
    priority: number;
    layouts: string[];
  }>;
};

const manifest: ManifestEntry[] = [];
let failures = 0;

function sampleText(slot: SlotKey, kind: SemanticTemplateKind): string {
  if (slot === "kicker") return kind.replace(/-/g, " ");
  if (slot === "title") return `${kind.replace(/-/g, " ")} template`;
  if (slot === "subtitle") {
    return "A native presentation semantic preview generated from slots.";
  }
  if (slot === "caption") {
    return "Generated from Deck, ThemePackageV1, and the semantic template registry.";
  }
  if (slot === "quote") {
    return "Design is the contract between structure and attention.";
  }
  if (slot === "attribution") return "TextIQ prototype";
  if (slot === "stat") return "72%";
  if (slot === "statLabel") return "Faster review cycles";
  if (slot === "leftTitle") return "Current state";
  if (slot === "rightTitle") return "Target state";
  if (slot === "body" || slot.endsWith("Body")) {
    return "Semantic slides keep layout, content, and theme styling separate so previews exercise the same path as the editor.";
  }
  return slot.replace(/([A-Z])/g, " $1").trim();
}

function sampleSlotValue(slot: SlotKey, kind: SemanticTemplateKind): SlotValue {
  if (slot === "bullets" || slot.endsWith("Bullets")) {
    return {
      type: "bullets",
      items: [
        { text: "Compile semantic slots into node trees" },
        { text: "Resolve visual style from the presentation theme package" },
        { text: "Render the shared Deck preview path" },
      ],
    };
  }
  if (slot === "body" || slot.endsWith("Body")) {
    return { type: "paragraph", paragraphs: [sampleText(slot, kind)] };
  }
  if (slot === "metrics") {
    return {
      type: "metrics",
      items: [
        { value: "72%", label: "Cycle time" },
        { value: "18", label: "Templates" },
        { value: "1", label: "Render tree" },
      ],
    };
  }
  if (slot === "cards") {
    return {
      type: "cards",
      items: [
        { title: "Plan", body: "Typed semantic intent" },
        { title: "Compile", body: "Stable presentation nodes" },
        { title: "Render", body: "Resolved tree output" },
      ],
    };
  }
  if (slot === "steps") {
    return {
      type: "steps",
      items: [
        { title: "Source", body: "ThemePackageV1" },
        { title: "Compile", body: "SlideNode" },
        { title: "Preview", body: "HTML" },
      ],
    };
  }
  if (slot === "table") {
    return {
      type: "table",
      columns: ["Layer", "Owner", "Output"],
      rows: [
        ["Template", "Registry", "SlideNode"],
        ["Theme", "Package", "Resolved style"],
        ["Preview", "Renderer", "HTML"],
      ],
      caption: "Native presentation table slot sample",
    };
  }
  if (slot === "visualId") {
    return { type: "visual", visualId: "sample-visual" };
  }
  if (slot === "imagePrompt") {
    return {
      type: "image",
      assetId: "placeholder",
      alt: "Generated placeholder",
    };
  }
  return { type: "shortText", text: sampleText(slot, kind) };
}

function sampleSlideSpec(kind: SemanticTemplateKind): SemanticSlideSpecV1 {
  const template = registry.get(kind);
  if (!template)
    throw new Error(`Missing presentation semantic template: ${kind}`);
  const slots: SemanticSlideSpecV1["slots"] = {};
  for (const slot of Object.keys(template.slots) as SlotKey[]) {
    slots[slot] = sampleSlotValue(slot, kind);
  }
  return {
    kind,
    tone: template.supports.tone[0],
    density: template.supports.density[0],
    emphasis: template.supports.emphasis[0],
    slots,
    speakerNotes: `${template.label} preview generated from the native presentation template registry.`,
  };
}

function previewDeckForThemePackage(themePackage: ThemePackageV1): Deck {
  resetIdCounter();
  const slides: SlideNode[] = SEMANTIC_TEMPLATE_KINDS.map((kind, index) => {
    const template = registry.get(kind);
    if (!template)
      throw new Error(`Missing presentation semantic template: ${kind}`);
    const { slide, diagnostics } = compileSlide(
      sampleSlideSpec(kind),
      template,
      index,
    );
    const blockingDiagnostics = diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.severity === "fatal",
    );
    if (blockingDiagnostics.length > 0) {
      throw new Error(
        `${kind} compile failed: ${blockingDiagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    return {
      ...slide,
      id: `${themePackage.id}-${kind}`,
      props: { decoration: "default", chrome: "default" } as const,
    };
  });

  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    id: `preview-${themePackage.id}`,
    title: `${themePackage.name} semantic template preview`,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: themePackage.id, packageVersion: themePackage.version },
    assets: { images: {} },
    slides,
    metadata: {
      extra: { source: "prototypes/slide-themes/theme-packages.ts" },
    },
  };
}

for (const themePackage of THEME_PACKAGE_SOURCES) {
  const packageValidation = validateThemePackage(themePackage);
  if (!packageValidation.valid) {
    failures += 1;
    console.error(
      `✗ ${themePackage.id} presentation package validation failed: ${packageValidation.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
    continue;
  }

  let deck: Deck;
  try {
    deck = previewDeckForThemePackage(themePackage);
  } catch (error) {
    failures += 1;
    console.error(
      `✗ ${themePackage.id} presentation preview deck failed to compile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    continue;
  }

  const parsed = safeParseDeck(deck);
  if (!parsed.success) {
    failures += 1;
    console.error(
      `✗ ${themePackage.id} preview deck FAILED presentation schema validation: ${parsed.errors.join("; ")}`,
    );
    continue;
  }

  const deckFile = `${themePackage.id}.deck.json`;
  const packageFile = `${themePackage.id}.package.json`;
  writeFileSync(
    join(deckOutDir, deckFile),
    `${JSON.stringify(parsed.data, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(packageOutDir, packageFile),
    `${JSON.stringify(packageValidation.package, null, 2)}\n`,
    "utf8",
  );

  manifest.push({
    id: themePackage.id,
    name: themePackage.name,
    tagline: themePackage.tagline ?? "",
    file: `decks/${deckFile}`,
    packageFile: `packages/${packageFile}`,
    schemaVersion: DECK_SCHEMA_VERSION,
    slides: parsed.data.slides.length,
    fonts: {
      heading: themePackage.tokens.fonts.heading,
      body: themePackage.tokens.fonts.body,
    },
    accent: themePackage.tokens.colors.accent.fill,
    templates: SEMANTIC_TEMPLATE_KINDS.map((kind) => {
      const template = registry.get(kind);
      if (!template)
        throw new Error(`Missing presentation semantic template: ${kind}`);
      return {
        kind,
        label: template.label,
        group: template.group,
        priority: template.selection.priority,
        layouts: template.layouts.map((layout) => layout.id),
      };
    }),
  });

  console.log(
    `✓ ${themePackage.name.padEnd(24)} valid presentation — theme-packages.ts → decks/${deckFile}`,
  );
}

writeFileSync(
  join(here, "manifest.json"),
  `${JSON.stringify({ themes: manifest }, null, 2)}\n`,
  "utf8",
);

if (failures > 0) {
  console.error(
    `\n${failures} presentation theme package(s) failed validation.`,
  );
  process.exit(1);
}

console.log(
  `\nAll ${manifest.length} presentation theme packages validated and written.`,
);
