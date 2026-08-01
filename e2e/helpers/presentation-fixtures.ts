function presentationFixture<
  const DocumentId extends string,
  const ShareId extends string,
  const Slug extends string,
  const DeckKind extends
    | "default"
    | "arrange"
    | "guides"
    | "touch"
    | "overlap"
    | "group"
    | "generated"
    | "sourceLinked"
    | "sourceReview"
    | "diagnostics"
    | "themeVersions",
>(
  documentId: DocumentId,
  shareId: ShareId,
  slug: Slug,
  deckKind: DeckKind = "default" as DeckKind,
) {
  return {
    documentId,
    shareId,
    slug,
    deckKind,
    deckRevisionToken: `e2e-deck-revision-${documentId}`,
  } as const;
}

export const PRESENTATION_TEST_FIXTURES = {
  editorRailMutations: presentationFixture(
    "e2eisolatededitorrail00001",
    "e2eisolatedshr01",
    "e2e-isolated-editor-rail",
  ),
  editorRoundtrip: presentationFixture(
    "e2eisolatedroundtrip00001",
    "e2eisolatedshr02",
    "e2e-isolated-roundtrip",
  ),
  editorUndoRedo: presentationFixture(
    "e2eisolatedundoredo000001",
    "e2eisolatedshr03",
    "e2e-isolated-undo-redo",
  ),
  blockIdPreservation: presentationFixture(
    "e2eisolatedblockids000001",
    "e2eisolatedshr27",
    "e2e-isolated-block-ids",
    "sourceLinked",
  ),
  slideDeleteCanonical: presentationFixture(
    "e2eisolateddeletecanon001",
    "e2eisolatedshr22",
    "e2e-isolated-delete-canonical",
  ),
  slideDeleteGenerated: presentationFixture(
    "e2eisolateddeletegen0001",
    "e2eisolatedshr23",
    "e2e-isolated-delete-generated",
    "generated",
  ),
  slideAssetUpload: presentationFixture(
    "e2eisolatedassetupload0001",
    "e2eisolatedshr04",
    "e2e-isolated-asset-upload",
  ),
  uiCommandPalette: presentationFixture(
    "e2eisolatedcommandpal00001",
    "e2eisolatedshr05",
    "e2e-isolated-command-palette",
  ),
  focusAndMobileControls: presentationFixture(
    "e2eisolatedfocusmobile0001",
    "e2eisolatedshr06",
    "e2e-isolated-focus-mobile",
  ),
  slidesSmokeTitleEdit: presentationFixture(
    "e2eisolatedsmoketitle0001",
    "e2eisolatedshr07",
    "e2e-isolated-smoke-title",
  ),
  slidesSmokeStageMutations: presentationFixture(
    "e2eisolatedsmokestage0001",
    "e2eisolatedshr08",
    "e2e-isolated-smoke-stage",
  ),
  slidesSmokeAddSlide: presentationFixture(
    "e2eisolatedsmokeadd000001",
    "e2eisolatedshr09",
    "e2e-isolated-smoke-add",
  ),
  slidesSmokeVisualInsert: presentationFixture(
    "e2eisolatedsmokevisual001",
    "e2eisolatedshr10",
    "e2e-isolated-smoke-visual",
  ),
  slidesSmokePresent: presentationFixture(
    "e2eisolatedsmokepresent01",
    "e2eisolatedshr24",
    "e2e-isolated-smoke-present",
  ),
  pointerFilmstripReorder: presentationFixture(
    "e2eisolatedpointerfilm001",
    "e2eisolatedshr11",
    "e2e-isolated-pointer-filmstrip",
  ),
  pointerNodeGeometry: presentationFixture(
    "e2eisolatedpointergeom001",
    "e2eisolatedshr12",
    "e2e-isolated-pointer-geometry",
  ),
  pointerConnectorSnap: presentationFixture(
    "e2eisolatedpointerconn001",
    "e2eisolatedshr13",
    "e2e-isolated-pointer-connector",
  ),
  conflictKeepMine: presentationFixture(
    "e2eisolatedconflictkeep001",
    "e2eisolatedshr14",
    "e2e-isolated-conflict-keep",
  ),
  conflictUseServer: presentationFixture(
    "e2eisolatedconflictsrv0001",
    "e2eisolatedshr15",
    "e2e-isolated-conflict-server",
  ),
  multiSelectArrange: presentationFixture(
    "e2eisolatedarrange000001",
    "e2eisolatedshr16",
    "e2e-isolated-arrange",
    "arrange",
  ),
  precisionGuides: presentationFixture(
    "e2eisolatedguides0000001",
    "e2eisolatedshr17",
    "e2e-isolated-guides",
    "guides",
  ),
  builtInTheme: presentationFixture(
    "e2eisolatedthemebuiltin01",
    "e2eisolatedshr18",
    "e2e-isolated-theme-built-in",
  ),
  customThemeAuthoring: presentationFixture(
    "e2eisolatedthemecustom001",
    "e2eisolatedshr19",
    "e2e-isolated-theme-custom",
  ),
  versionedCustomTheme: presentationFixture(
    "e2eisolatedthemeversions01",
    "e2eisolatedshr21",
    "e2e-isolated-theme-versions",
    "themeVersions",
  ),
  touchControls: presentationFixture(
    "e2eisolatedtouchcontrols01",
    "e2eisolatedshr20",
    "e2e-isolated-touch-controls",
    "touch",
  ),
  overlapSelection: presentationFixture(
    "e2eisolatedoverlap000001",
    "e2eisolatedshr25",
    "e2e-isolated-overlap-selection",
    "overlap",
  ),
  groupLayerOrder: presentationFixture(
    "e2eisolatedgrouplayers001",
    "e2eisolatedshr26",
    "e2e-isolated-group-layers",
    "group",
  ),
  slideRatio: presentationFixture(
    "e2eisolatedslideratio00001",
    "e2eisolatedshr28",
    "e2e-isolated-slide-ratio",
  ),
  slideMaster: presentationFixture(
    "e2eisolatedslidemaster0001",
    "e2eisolatedshr29",
    "e2e-isolated-slide-master",
  ),
  sourceReview: presentationFixture(
    "e2eisolatedsourcereview001",
    "e2eisolatedshr30",
    "e2e-isolated-source-review",
    "sourceReview",
  ),
  sourceActions: presentationFixture(
    "e2eisolatedsourceactions01",
    "e2eisolatedshr31",
    "e2e-isolated-source-actions",
    "sourceReview",
  ),
  speakerNotes: presentationFixture(
    "e2eisolatedspeakernotes001",
    "e2eisolatedshr32",
    "e2e-isolated-speaker-notes",
  ),
  deckDiagnostics: presentationFixture(
    "e2eisolateddiagnostics001",
    "e2eisolatedshr33",
    "e2e-isolated-deck-diagnostics",
    "diagnostics",
  ),
  imageCrop: presentationFixture(
    "e2eisolatedimagecrop0001",
    "e2eisolatedshr34",
    "e2e-isolated-image-crop",
  ),
  inlineRichText: presentationFixture(
    "e2eisolatedrichtext0001",
    "e2eisolatedshr35",
    "e2e-isolated-rich-text",
  ),
  inlineList: presentationFixture(
    "e2eisolatedinlinelist001",
    "e2eisolatedshr36",
    "e2e-isolated-inline-list",
  ),
} as const;

export type PresentationTestFixtureName =
  keyof typeof PRESENTATION_TEST_FIXTURES;

export type PresentationTestFixture = {
  documentId: string;
  shareId: string;
  slug: string;
  deckKind: (typeof PRESENTATION_TEST_FIXTURES)[PresentationTestFixtureName]["deckKind"];
  deckRevisionToken: string;
};

export type PresentationFixtureSlotInput = {
  repeatEachIndex: number;
  parallelIndex: number;
  project: { name: string };
};

export const SLIDES_SMOKE_MUTATION_FIXTURES = {
  titleEdit: "slidesSmokeTitleEdit",
  stageMutations: "slidesSmokeStageMutations",
  addSlide: "slidesSmokeAddSlide",
  visualInsert: "slidesSmokeVisualInsert",
  present: "slidesSmokePresent",
  inlineRichText: "inlineRichText",
  inlineList: "inlineList",
} as const satisfies Record<string, PresentationTestFixtureName>;

export const POINTER_INTERACTION_FIXTURES = {
  filmstripReorder: "pointerFilmstripReorder",
  nodeGeometry: "pointerNodeGeometry",
  connectorSnap: "pointerConnectorSnap",
  imageCrop: "imageCrop",
} as const satisfies Record<string, PresentationTestFixtureName>;

export const CONFLICT_RECOVERY_FIXTURES = {
  keepMine: "conflictKeepMine",
  useServer: "conflictUseServer",
} as const satisfies Record<string, PresentationTestFixtureName>;

export const PRESENTATION_CONTROL_FIXTURES = {
  multiSelectArrange: "multiSelectArrange",
  precisionGuides: "precisionGuides",
  builtInTheme: "builtInTheme",
  customThemeAuthoring: "customThemeAuthoring",
  versionedCustomTheme: "versionedCustomTheme",
  touchControls: "touchControls",
  groupLayerOrder: "groupLayerOrder",
  slideRatio: "slideRatio",
  slideMaster: "slideMaster",
  sourceReview: "sourceReview",
  sourceActions: "sourceActions",
  speakerNotes: "speakerNotes",
  deckDiagnostics: "deckDiagnostics",
} as const satisfies Record<string, PresentationTestFixtureName>;

export const E2E_CUSTOM_THEME_FIXTURE = {
  name: "E2E Presentation Theme",
  slug: "e2e-presentation-theme",
  version: "9.9.1",
} as const;

export const E2E_VERSIONED_THEME_FIXTURE = {
  packageId: "brand-kit:e2e-versioned-theme",
  activeVersion: "1.0.0",
  activeName: "E2E Versioned Theme v1",
  latestVersion: "2.0.0",
  latestName: "E2E Versioned Theme v2",
} as const;

export const E2E_CONFLICT_OWNER_THEME_FIXTURE = {
  packageId: "brand-kit:e2e-conflict-owner-only",
  version: "1.0.0",
  name: "E2E Owner-only Conflict Theme",
  canvasFill: "#7c3aed",
} as const;

export function presentationTestFixture(
  name: PresentationTestFixtureName,
  slotOrTestInfo: PresentationFixtureSlotInput = DEFAULT_PRESENTATION_FIXTURE_SLOT,
  env: Record<string, string | undefined> = process.env,
): PresentationTestFixture {
  const fixture = PRESENTATION_TEST_FIXTURES[name];
  const slot = assertPresentationFixtureSlotSeeded(slotOrTestInfo, env);
  if (slot === DEFAULT_PRESENTATION_FIXTURE_SLOT_KEY) {
    return fixture;
  }

  return {
    ...fixture,
    documentId: `${fixture.documentId}${slot}`,
    shareId: `${fixture.shareId}${slot}`,
    slug: `${fixture.slug}-${slot}`,
    deckRevisionToken: `${fixture.deckRevisionToken}-${slot}`,
  };
}

export const DEFAULT_PRESENTATION_FIXTURE_SLOT = {
  project: { name: "chromium" },
  repeatEachIndex: 0,
  parallelIndex: 0,
} as const satisfies PresentationFixtureSlotInput;

const DEFAULT_PRESENTATION_FIXTURE_SLOT_KEY = "p6368726f6d69756dr0x0";

function encodeProjectName(projectName: string): string {
  return Array.from(new TextEncoder().encode(projectName))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stable fixture identity: project name (UTF-8 hex), repeat index, and
 * Playwright parallel index. `parallelIndex` is used instead of `workerIndex`
 * because it remains stable if Playwright replaces a failed worker process.
 */
export function presentationFixtureSlotKey({
  project,
  repeatEachIndex,
  parallelIndex,
}: PresentationFixtureSlotInput): string {
  if (!project.name.trim()) {
    throw new Error("Playwright project name must be non-empty.");
  }
  for (const [label, value] of [
    ["repeatEachIndex", repeatEachIndex],
    ["parallelIndex", parallelIndex],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Playwright ${label} must be a non-negative integer.`);
    }
  }
  return `p${encodeProjectName(project.name)}r${repeatEachIndex.toString(36)}x${parallelIndex.toString(36)}`;
}

export function configuredPresentationFixtureSlots(
  env: Record<string, string | undefined> = process.env,
): PresentationFixtureSlotInput[] {
  const raw = env.E2E_PROFILE_FIXTURE_SLOTS?.trim();
  if (!raw) return [DEFAULT_PRESENTATION_FIXTURE_SLOT];
  let slots: unknown;
  try {
    slots = JSON.parse(raw);
  } catch {
    throw new Error(
      "E2E_PROFILE_FIXTURE_SLOTS must be a JSON array of Playwright fixture slots.",
    );
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error(
      "E2E_PROFILE_FIXTURE_SLOTS must contain at least one Playwright fixture slot.",
    );
  }
  const parsed = slots.map((slot) => {
    if (!slot || typeof slot !== "object") {
      throw new Error(
        "Each configured presentation fixture slot must be an object.",
      );
    }
    const candidate = slot as {
      projectName?: unknown;
      repeatEachIndex?: unknown;
      parallelIndex?: unknown;
    };
    const parsedSlot = {
      project: { name: String(candidate.projectName ?? "") },
      repeatEachIndex: Number(candidate.repeatEachIndex),
      parallelIndex: Number(candidate.parallelIndex),
    };
    presentationFixtureSlotKey(parsedSlot);
    return parsedSlot;
  });
  const keys = parsed.map(presentationFixtureSlotKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "E2E_PROFILE_FIXTURE_SLOTS contains duplicate stable identities.",
    );
  }
  return parsed;
}

export function configuredPresentationTestFixtures(
  env: Record<string, string | undefined> = process.env,
): PresentationTestFixture[] {
  const slots = configuredPresentationFixtureSlots(env);
  const fixtureNames = Object.keys(
    PRESENTATION_TEST_FIXTURES,
  ) as PresentationTestFixtureName[];
  return fixtureNames.flatMap((fixtureName) =>
    slots.map((slot) => presentationTestFixture(fixtureName, slot, env)),
  );
}

export function assertPresentationFixtureSlotSeeded(
  slot: PresentationFixtureSlotInput,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = presentationFixtureSlotKey(slot);
  const seededKeys = new Set(
    configuredPresentationFixtureSlots(env).map(presentationFixtureSlotKey),
  );
  if (!seededKeys.has(key)) {
    throw new Error(
      `Playwright fixture slot ${key} was not seeded; rerun through the profile runner with matching --project, --repeat-each, and --workers arguments.`,
    );
  }
  return key;
}
