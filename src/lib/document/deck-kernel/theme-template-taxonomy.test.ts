import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SEMANTIC_TO_RENDER_FAMILY,
  THEME_PACKAGE_RENDER_FAMILIES,
  THEME_PACKAGE_TEMPLATE_ARTIFACT_ROLES,
  THEME_PACKAGE_TEMPLATE_CONTENT_MEDIA,
  THEME_PACKAGE_TEMPLATE_GROUPS,
  THEME_PACKAGE_TEMPLATE_INTENTS,
  THEME_PACKAGE_TEMPLATE_KINDS,
  THEME_PACKAGE_TEMPLATE_METADATA,
  isThemePackageTemplateKind,
  resolveThemePackageTemplateKind,
  templateCategoryForFamily,
} from "./theme-template-taxonomy";

// ---------------------------------------------------------------------------
// isThemePackageTemplateKind / resolveThemePackageTemplateKind — membership
// ---------------------------------------------------------------------------

test("isThemePackageTemplateKind accepts every canonical kind", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    assert.equal(isThemePackageTemplateKind(kind), true);
  }
});

test("isThemePackageTemplateKind rejects unknown strings and non-strings", () => {
  assert.equal(isThemePackageTemplateKind("not-a-kind"), false);
  assert.equal(isThemePackageTemplateKind(42), false);
  assert.equal(isThemePackageTemplateKind(undefined), false);
  assert.equal(isThemePackageTemplateKind(null), false);
});

test("resolveThemePackageTemplateKind returns the value when it is a known kind", () => {
  assert.equal(resolveThemePackageTemplateKind("cover"), "cover");
});

test("resolveThemePackageTemplateKind returns undefined for unknown/malformed input", () => {
  assert.equal(resolveThemePackageTemplateKind("not-a-kind"), undefined);
  assert.equal(resolveThemePackageTemplateKind(123), undefined);
  assert.equal(resolveThemePackageTemplateKind(null), undefined);
});

// ---------------------------------------------------------------------------
// templateCategoryForFamily — every branch of the family → category mapping
// ---------------------------------------------------------------------------

test("templateCategoryForFamily maps cover and closing families to the title category", () => {
  assert.equal(templateCategoryForFamily("cover"), "title");
  assert.equal(templateCategoryForFamily("closing"), "title");
});

test("templateCategoryForFamily maps section-divider to the section category", () => {
  assert.equal(templateCategoryForFamily("section-divider"), "section");
});

test("templateCategoryForFamily maps visual-focus to the media category", () => {
  assert.equal(templateCategoryForFamily("visual-focus"), "media");
});

test("templateCategoryForFamily maps two-column and matrix-2x2 to the comparison category", () => {
  assert.equal(templateCategoryForFamily("two-column"), "comparison");
  assert.equal(templateCategoryForFamily("matrix-2x2"), "comparison");
});

test("templateCategoryForFamily maps every other render family to the content category", () => {
  for (const family of THEME_PACKAGE_RENDER_FAMILIES) {
    if (
      family === "cover" ||
      family === "closing" ||
      family === "section-divider" ||
      family === "visual-focus" ||
      family === "two-column" ||
      family === "matrix-2x2"
    ) {
      continue;
    }
    assert.equal(templateCategoryForFamily(family), "content");
  }
});

// ---------------------------------------------------------------------------
// THEME_PACKAGE_TEMPLATE_METADATA — full membership/resolution consistency
// across every taxonomy kind (exercises groupForKind, contentMediumForKind,
// artifactRoleForKind, acceptsForFamily, bindingsForSlots, capacityForFamily,
// and bestFor indirectly via the module-level table they build).
// ---------------------------------------------------------------------------

test("THEME_PACKAGE_TEMPLATE_METADATA has exactly one entry per canonical kind", () => {
  const keys = Object.keys(THEME_PACKAGE_TEMPLATE_METADATA);
  assert.equal(keys.length, THEME_PACKAGE_TEMPLATE_KINDS.length);
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    assert.ok(
      kind in THEME_PACKAGE_TEMPLATE_METADATA,
      `missing metadata for "${kind}"`,
    );
  }
});

test("every metadata entry's renderFamily matches the canonical SEMANTIC_TO_RENDER_FAMILY mapping", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    assert.equal(
      THEME_PACKAGE_TEMPLATE_METADATA[kind].renderFamily,
      SEMANTIC_TO_RENDER_FAMILY[kind],
    );
  }
});

test("every metadata entry's group/intent, contentMedium, and artifactRole are valid taxonomy members", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const metadata = THEME_PACKAGE_TEMPLATE_METADATA[kind];
    assert.ok(
      (THEME_PACKAGE_TEMPLATE_GROUPS as readonly string[]).includes(
        metadata.group,
      ),
      `${kind}: group "${metadata.group}" is not a canonical group`,
    );
    assert.equal(metadata.group, metadata.intent);
    assert.ok(
      (THEME_PACKAGE_TEMPLATE_INTENTS as readonly string[]).includes(
        metadata.intent,
      ),
    );
    assert.ok(
      (THEME_PACKAGE_TEMPLATE_CONTENT_MEDIA as readonly string[]).includes(
        metadata.contentMedium,
      ),
      `${kind}: contentMedium "${metadata.contentMedium}" is not a canonical medium`,
    );
    if (metadata.artifactRole !== undefined) {
      assert.ok(
        (THEME_PACKAGE_TEMPLATE_ARTIFACT_ROLES as readonly string[]).includes(
          metadata.artifactRole,
        ),
        `${kind}: artifactRole "${metadata.artifactRole}" is not a canonical role`,
      );
    }
  }
});

test("every metadata entry's priority is a unique 1-based index matching taxonomy order", () => {
  const priorities = THEME_PACKAGE_TEMPLATE_KINDS.map(
    (kind) => THEME_PACKAGE_TEMPLATE_METADATA[kind].priority,
  );
  assert.deepEqual(
    priorities,
    THEME_PACKAGE_TEMPLATE_KINDS.map((_, index) => index + 1),
  );
});

test("every metadata entry marks 'title' as required exactly when it accepts a title slot", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const metadata = THEME_PACKAGE_TEMPLATE_METADATA[kind];
    if (metadata.accepts.includes("title")) {
      assert.deepEqual(metadata.required, ["title"]);
    } else {
      assert.equal(metadata.required, undefined);
    }
  }
});

test("every metadata entry's signals include its own kind, renderFamily, intent, and contentMedium", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const metadata = THEME_PACKAGE_TEMPLATE_METADATA[kind];
    assert.ok(metadata.signals.includes(kind));
    assert.ok(metadata.signals.includes(metadata.renderFamily));
    assert.ok(metadata.signals.includes(metadata.intent));
    assert.ok(metadata.signals.includes(metadata.contentMedium));
  }
});

test("every metadata entry's signals list has no duplicate values", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const signals = THEME_PACKAGE_TEMPLATE_METADATA[kind].signals;
    assert.equal(
      new Set(signals).size,
      signals.length,
      `${kind}: signals contain duplicates`,
    );
  }
});

test("every metadata entry's bindings only cover slots it accepts, and every binding target is well-formed", () => {
  const validTargets = new Set([
    "title",
    "subtitle",
    "body",
    "bullets",
    "table",
    "visual",
    "caption",
  ]);
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const metadata = THEME_PACKAGE_TEMPLATE_METADATA[kind];
    const acceptedSlots = new Set(metadata.accepts);
    for (const binding of metadata.bindings) {
      assert.ok(
        acceptedSlots.has(binding.slot),
        `${kind}: binding slot "${binding.slot}" not in accepts`,
      );
      assert.ok(validTargets.has(binding.target));
    }
  }
});

test("capacity metadata carries the field matching the render family's structural shape", () => {
  const tableFamilies = new Set(["table", "data-insight", "risk-register"]);
  const cardFamilies = new Set(["team-grid", "pricing-cards"]);
  const stepFamilies = new Set(["process-steps", "timeline", "roadmap"]);
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const metadata = THEME_PACKAGE_TEMPLATE_METADATA[kind];
    const { capacity, renderFamily } = metadata;
    if (tableFamilies.has(renderFamily)) {
      assert.deepEqual(capacity, { table: { columns: 4, rows: 6 } });
    } else if (cardFamilies.has(renderFamily)) {
      assert.deepEqual(capacity, { cards: 3 });
    } else if (renderFamily === "metric-row") {
      assert.deepEqual(capacity, { metrics: 4 });
    } else if (renderFamily === "title-body") {
      assert.deepEqual(capacity, { body: { paragraphs: 4, chars: 900 } });
    } else if (stepFamilies.has(renderFamily)) {
      assert.deepEqual(capacity, { steps: 5 });
    } else {
      assert.deepEqual(capacity, { bullets: 5 });
    }
  }
});

test("the 'table' kind carries an avoidFor hint pointing to 'evidence'; other kinds omit avoidFor", () => {
  assert.equal(
    THEME_PACKAGE_TEMPLATE_METADATA.table.avoidFor,
    "Proof-heavy source support; prefer evidence.",
  );
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    if (kind === "table") continue;
    assert.equal(THEME_PACKAGE_TEMPLATE_METADATA[kind].avoidFor, undefined);
  }
});

test("every metadata entry's bestFor description is a non-empty string", () => {
  for (const kind of THEME_PACKAGE_TEMPLATE_KINDS) {
    const bestFor = THEME_PACKAGE_TEMPLATE_METADATA[kind].bestFor;
    assert.ok(bestFor.length > 0);
  }
});

test("distinct bestFor branches produce distinguishable copy for detail, evidence, and table kinds", () => {
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.detail.bestFor,
    /explanatory narrative/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.evidence.bestFor,
    /Proof, evidence/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.table.bestFor,
    /structured data/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.comparison.bestFor,
    /comparisons/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.process.bestFor,
    /Sequential steps/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.timeline.bestFor,
    /Chronological/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.roadmap.bestFor,
    /Forward-looking/,
  );
  assert.match(
    THEME_PACKAGE_TEMPLATE_METADATA.insight.bestFor,
    /Results, experiments/,
  );
  // A kind with none of the special-cased branches falls through to the
  // generic "<Title Case> slide content." template.
  assert.equal(
    THEME_PACKAGE_TEMPLATE_METADATA.agenda.bestFor,
    "Agenda slide content.",
  );
});
