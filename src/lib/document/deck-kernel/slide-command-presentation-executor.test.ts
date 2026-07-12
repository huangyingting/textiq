import assert from "node:assert/strict";
import { test } from "node:test";

import { executePresentationThemeFamilyCommand } from "./slide-command-presentation-executor";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import type {
  AddSlideFromTemplateCommand,
  ApplySlideTemplateCommand,
  ApplyThemePackageCommand,
  CreateCustomTemplateCommand,
  CreateMasterCommand,
  DeleteCustomTemplateCommand,
  DeleteMasterCommand,
  SetCanvasFormatCommand,
  SetDefaultMasterCommand,
  SetPresentationThemeCommand,
  SetSlideMasterCommand,
  UpdateCustomTemplateCommand,
  UpdateMasterCommand,
  UpdateMasterElementCommand,
  UpdateThemeOverridesCommand,
} from "./slide-command-contracts";
import type { MasterElement, SlideMaster, SlideTemplate } from "./deck-core";

function twoSlideDeck() {
  return makeDeck([makeSlide({ id: "s1" }), makeSlide({ id: "s2" })]);
}

function logoMasterElement(
  overrides: Partial<MasterElement> = {},
): MasterElement {
  return {
    id: "chrome-1",
    kind: "image",
    role: "logo",
    box: { x: 0, y: 0, w: 20, h: 10 },
    zIndex: 0,
    layer: "foreground",
    locked: true,
    masterChromeKind: "logo",
    content: { kind: "image", src: "https://example.com/logo.png" },
    ...overrides,
  } as MasterElement;
}

function validMaster(overrides: Partial<SlideMaster> = {}): SlideMaster {
  return {
    id: "master-1",
    name: "Master One",
    elements: [logoMasterElement()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SET_PRESENTATION_THEME
// ---------------------------------------------------------------------------

test("SET_PRESENTATION_THEME sets the theme and affects every slide", () => {
  const deck = twoSlideDeck();
  const cmd: SetPresentationThemeCommand = {
    type: "SET_PRESENTATION_THEME",
    themeId: "indigo",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.design?.themeId, "indigo");
  assert.deepEqual(result.affectedSlideIds, ["s1", "s2"]);
  assert.equal(result.patches[0]!.op, "presentation.set_theme");
});

// ---------------------------------------------------------------------------
// APPLY_THEME_PACKAGE
// ---------------------------------------------------------------------------

test("APPLY_THEME_PACKAGE applies a known built-in package", () => {
  const deck = twoSlideDeck();
  const cmd: ApplyThemePackageCommand = {
    type: "APPLY_THEME_PACKAGE",
    packageId: "aurora",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.design?.themeId, "aurora");
  assert.equal(result.patches[0]!.op, "presentation.apply_theme_package");
});

test("APPLY_THEME_PACKAGE fails for an unknown package id", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "APPLY_THEME_PACKAGE",
    packageId: "not-a-real-package",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Theme package not found: not-a-real-package");
  assert.equal(result.deck, deck);
});

// ---------------------------------------------------------------------------
// UPDATE_THEME_OVERRIDES
// ---------------------------------------------------------------------------

test("UPDATE_THEME_OVERRIDES merges a patch into the theme overrides token set", () => {
  const deck = twoSlideDeck();
  const cmd: UpdateThemeOverridesCommand = {
    type: "UPDATE_THEME_OVERRIDES",
    patch: { typography: { fontFamily: "Inter" } },
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const tokenSet = result.deck.design?.themeOverrides?.tokenSet as {
    typography?: { fontFamily?: string };
  };
  assert.equal(tokenSet.typography?.fontFamily, "Inter");
  assert.equal(result.patches[0]!.op, "presentation.update_theme_overrides");
});

test("UPDATE_THEME_OVERRIDES resets overrides when reset is true", () => {
  const deck = makeDeck([makeSlide({ id: "s1" })], {
    design: {
      themeId: "aurora",
      themeOverrides: { tokenSet: { id: "custom:aurora", name: "Custom" } },
    },
  });
  const cmd: UpdateThemeOverridesCommand = {
    type: "UPDATE_THEME_OVERRIDES",
    patch: {},
    reset: true,
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  // "aurora" is a built-in theme package, so reset re-derives the token set
  // from the package's own defaults rather than clearing it to undefined.
  const resetTokenSet = (
    result.deck.design?.themeOverrides as
      | { tokenSet?: { id?: string; name?: string } }
      | undefined
  )?.tokenSet;
  assert.notEqual(resetTokenSet?.id, "custom:aurora");
  assert.notEqual(resetTokenSet?.name, "Custom");
  assert.deepEqual(result.patches[0]!.deckFields, {
    resetThemeOverrides: true,
  });
});

// ---------------------------------------------------------------------------
// SET_CANVAS_FORMAT
// ---------------------------------------------------------------------------

test("SET_CANVAS_FORMAT sets the deck's canvas format", () => {
  const deck = twoSlideDeck();
  const cmd: SetCanvasFormatCommand = {
    type: "SET_CANVAS_FORMAT",
    format: "4:3",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.canvas?.format, "4:3");
  assert.equal(result.patches[0]!.op, "canvas.set_format");
});

// ---------------------------------------------------------------------------
// CREATE_MASTER / UPDATE_MASTER / DELETE_MASTER / SET_DEFAULT_MASTER
// ---------------------------------------------------------------------------

test("CREATE_MASTER adds a valid master", () => {
  const deck = twoSlideDeck();
  const cmd: CreateMasterCommand = {
    type: "CREATE_MASTER",
    master: validMaster(),
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.masters?.length, 1);
  assert.deepEqual(result.patches[0]!.addedIds, ["master-1"]);
});

test("CREATE_MASTER fails when the master id already exists", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "CREATE_MASTER",
    master: validMaster(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master already exists: master-1");
});

test("CREATE_MASTER fails when a master element is invalid", () => {
  const deck = twoSlideDeck();
  const cmd: CreateMasterCommand = {
    type: "CREATE_MASTER",
    master: validMaster({
      elements: [logoMasterElement({ layer: "sideground" as never })],
    }),
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, false);
  assert.match(result.error!, /layer must be "background" or "foreground"/);
});

test("UPDATE_MASTER patches an existing master", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const cmd: UpdateMasterCommand = {
    type: "UPDATE_MASTER",
    masterId: "master-1",
    patch: { name: "Renamed master" },
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.masters?.[0]!.name, "Renamed master");
});

test("UPDATE_MASTER fails for an unknown masterId", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "UPDATE_MASTER",
    masterId: "missing",
    patch: { name: "x" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master not found: missing");
});

test("DELETE_MASTER removes a non-default master and clears slide references", () => {
  const deck = {
    ...twoSlideDeck(),
    masters: [validMaster()],
    defaultMasterId: "other-default",
  };
  deck.slides[0]!.masterId = "master-1";
  const cmd: DeleteMasterCommand = {
    type: "DELETE_MASTER",
    masterId: "master-1",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.masters, []);
  assert.equal(result.deck.slides[0]!.masterId, undefined);
  assert.deepEqual(result.patches[0]!.removedIds, ["master-1"]);
});

test("DELETE_MASTER fails for an unknown masterId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "DELETE_MASTER",
    masterId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master not found: missing");
});

test("DELETE_MASTER refuses to delete the default master", () => {
  const deck = {
    ...twoSlideDeck(),
    masters: [validMaster()],
    defaultMasterId: "master-1",
  };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "DELETE_MASTER",
    masterId: "master-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Cannot delete the default master");
});

test("SET_DEFAULT_MASTER sets the default master id", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const cmd: SetDefaultMasterCommand = {
    type: "SET_DEFAULT_MASTER",
    masterId: "master-1",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.defaultMasterId, "master-1");
});

test("SET_DEFAULT_MASTER fails for an unknown masterId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "SET_DEFAULT_MASTER",
    masterId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master not found: missing");
});

// ---------------------------------------------------------------------------
// SET_SLIDE_MASTER
// ---------------------------------------------------------------------------

test("SET_SLIDE_MASTER assigns a known master to a slide", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const cmd: SetSlideMasterCommand = {
    type: "SET_SLIDE_MASTER",
    slideId: "s1",
    masterId: "master-1",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.masterId, "master-1");
});

test("SET_SLIDE_MASTER clears the master when masterId is undefined", () => {
  const deck = twoSlideDeck();
  deck.slides[0]!.masterId = "master-1";
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "SET_SLIDE_MASTER",
    slideId: "s1",
    masterId: undefined,
  });
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.masterId, undefined);
});

test("SET_SLIDE_MASTER fails for an unknown masterId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "SET_SLIDE_MASTER",
    slideId: "s1",
    masterId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master not found: missing");
});

test("SET_SLIDE_MASTER fails for an unknown slideId", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "SET_SLIDE_MASTER",
    slideId: "missing",
    masterId: "master-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// UPDATE_MASTER_ELEMENT
// ---------------------------------------------------------------------------

test("UPDATE_MASTER_ELEMENT patches a master element and forces it locked", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const cmd: UpdateMasterElementCommand = {
    type: "UPDATE_MASTER_ELEMENT",
    masterId: "master-1",
    elementId: "chrome-1",
    patch: { opacity: 0.8 },
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  const updated = result.deck.masters![0]!.elements[0]!;
  assert.equal((updated as { opacity?: number }).opacity, 0.8);
  assert.equal(updated.locked, true);
});

test("UPDATE_MASTER_ELEMENT fails for an unknown masterId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "UPDATE_MASTER_ELEMENT",
    masterId: "missing",
    elementId: "chrome-1",
    patch: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master not found: missing");
});

test("UPDATE_MASTER_ELEMENT fails for an unknown elementId", () => {
  const deck = { ...twoSlideDeck(), masters: [validMaster()] };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "UPDATE_MASTER_ELEMENT",
    masterId: "master-1",
    elementId: "missing",
    patch: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Master element not found: missing");
});

// ---------------------------------------------------------------------------
// ADD_SLIDE_FROM_TEMPLATE / APPLY_SLIDE_TEMPLATE
// ---------------------------------------------------------------------------

test("ADD_SLIDE_FROM_TEMPLATE materializes a built-in template after the given slide", () => {
  const deck = twoSlideDeck();
  const cmd: AddSlideFromTemplateCommand = {
    type: "ADD_SLIDE_FROM_TEMPLATE",
    templateId: "title",
    afterSlideId: "s1",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides.length, 3);
  assert.equal(result.deck.slides[1]!.templateId, "title");
});

test("ADD_SLIDE_FROM_TEMPLATE fails for an unknown templateId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "ADD_SLIDE_FROM_TEMPLATE",
    templateId: "not-a-template",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Template not found: not-a-template");
});

test("ADD_SLIDE_FROM_TEMPLATE fails for a missing afterSlideId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "ADD_SLIDE_FROM_TEMPLATE",
    templateId: "title",
    afterSlideId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

test("APPLY_SLIDE_TEMPLATE replaces a slide's template and elements", () => {
  const deck = twoSlideDeck();
  const cmd: ApplySlideTemplateCommand = {
    type: "APPLY_SLIDE_TEMPLATE",
    slideId: "s1",
    templateId: "title",
    mode: "replace",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.slides[0]!.templateId, "title");
});

test("APPLY_SLIDE_TEMPLATE fails for an unknown templateId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "APPLY_SLIDE_TEMPLATE",
    slideId: "s1",
    templateId: "not-a-template",
    mode: "replace",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Template not found: not-a-template");
});

test("APPLY_SLIDE_TEMPLATE fails for a missing slideId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "APPLY_SLIDE_TEMPLATE",
    slideId: "missing",
    templateId: "title",
    mode: "replace",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Slide not found: missing");
});

// ---------------------------------------------------------------------------
// CREATE_CUSTOM_TEMPLATE / UPDATE_CUSTOM_TEMPLATE / DELETE_CUSTOM_TEMPLATE
// ---------------------------------------------------------------------------

function customTemplate(overrides: Partial<SlideTemplate> = {}): SlideTemplate {
  return {
    id: "custom-1",
    name: "Custom One",
    category: "content",
    elements: [],
    ...overrides,
  };
}

test("CREATE_CUSTOM_TEMPLATE adds a new custom template", () => {
  const deck = twoSlideDeck();
  const cmd: CreateCustomTemplateCommand = {
    type: "CREATE_CUSTOM_TEMPLATE",
    template: customTemplate(),
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.customTemplates?.[0]!.source, "custom");
  assert.equal(result.deck.customTemplates?.[0]!.styleMode, "fixed");
});

test("CREATE_CUSTOM_TEMPLATE fails when the id collides with a theme package template id", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "CREATE_CUSTOM_TEMPLATE",
    template: customTemplate({ id: "theme:aurora:cover" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error!, /Theme package template ids are reserved/);
});

test("CREATE_CUSTOM_TEMPLATE fails when the template id already exists", () => {
  const deck = { ...twoSlideDeck(), customTemplates: [customTemplate()] };
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "CREATE_CUSTOM_TEMPLATE",
    template: customTemplate(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Template already exists: custom-1");
});

test("UPDATE_CUSTOM_TEMPLATE patches an existing custom template", () => {
  const deck = { ...twoSlideDeck(), customTemplates: [customTemplate()] };
  const cmd: UpdateCustomTemplateCommand = {
    type: "UPDATE_CUSTOM_TEMPLATE",
    templateId: "custom-1",
    patch: { name: "Renamed" },
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.equal(result.deck.customTemplates?.[0]!.name, "Renamed");
});

test("UPDATE_CUSTOM_TEMPLATE fails for an unknown templateId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "UPDATE_CUSTOM_TEMPLATE",
    templateId: "missing",
    patch: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Template not found: missing");
});

test("DELETE_CUSTOM_TEMPLATE removes an existing custom template", () => {
  const deck = { ...twoSlideDeck(), customTemplates: [customTemplate()] };
  const cmd: DeleteCustomTemplateCommand = {
    type: "DELETE_CUSTOM_TEMPLATE",
    templateId: "custom-1",
  };
  const result = executePresentationThemeFamilyCommand(deck, cmd);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.customTemplates, []);
  assert.deepEqual(result.patches[0]!.removedIds, ["custom-1"]);
});

test("DELETE_CUSTOM_TEMPLATE fails for a theme package template id", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "DELETE_CUSTOM_TEMPLATE",
    templateId: "theme:aurora:cover",
  });
  assert.equal(result.ok, false);
  assert.match(result.error!, /Theme package templates cannot be deleted/);
});

test("DELETE_CUSTOM_TEMPLATE fails for an unknown templateId", () => {
  const deck = twoSlideDeck();
  const result = executePresentationThemeFamilyCommand(deck, {
    type: "DELETE_CUSTOM_TEMPLATE",
    templateId: "missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Template not found: missing");
});
