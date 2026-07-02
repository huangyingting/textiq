import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ThemePackageV1 } from "@/lib/presentation-vnext/theme-package-schema";

import {
  createBrandKitAuthoringState,
  createDefaultBrandKitDraft,
  diagnosticsForPath,
  saveBrandKitAuthoringState,
  updateBrandKitDecoration,
  updateBrandKitIdentity,
  updateBrandKitLogo,
  updateBrandKitPaletteColor,
  updateBrandKitTypography,
} from "./brand-kit-authoring-controller";

function state() {
  return createBrandKitAuthoringState(
    createDefaultBrandKitDraft({
      ownerId: "user-1",
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
}

describe("brand kit authoring controller", () => {
  test("editing palette, typography, assets, and decorations updates draft state", () => {
    let current = state();

    current = updateBrandKitIdentity(current, "slug", "acme-kit");
    current = updateBrandKitPaletteColor(
      current,
      "palette.accents.primary",
      "#123456",
    );
    current = updateBrandKitTypography(current, "heading", "family", "Aptos");
    current = updateBrandKitTypography(current, "heading", "sizePt", "34");
    current = updateBrandKitLogo(
      current,
      "src",
      "https://example.com/logo.svg",
    );
    current = updateBrandKitLogo(current, "widthPx", "128");
    current = updateBrandKitDecoration(current, "background", "expressive");

    assert.equal(current.draft.slug, "acme-kit");
    assert.equal(current.draft.palette.accents.primary, "#123456");
    assert.equal(current.draft.typography.heading.family, "Aptos");
    assert.equal(current.draft.typography.heading.sizePt, 34);
    assert.equal(
      current.draft.assets?.logo?.src,
      "https://example.com/logo.svg",
    );
    assert.equal(current.draft.assets?.logo?.widthPx, 128);
    assert.equal(current.draft.decorations?.background, "expressive");
    assert.equal(current.compileResult.ok, true);
  });

  test("invalid draft surfaces compiler errors by authoring path", () => {
    const current = updateBrandKitPaletteColor(
      state(),
      "palette.backgrounds.canvas",
      "not-a-color",
    );

    assert.equal(current.compileResult.ok, false);
    const diagnostics = diagnosticsForPath(
      current.compileResult.diagnostics,
      "palette.backgrounds.canvas",
    );
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0]!.message, /#RRGGBB/);
  });

  test("save compiles before crossing the async boundary and passes compiled package", async () => {
    const current = updateBrandKitIdentity(state(), "slug", "saved-kit");
    const calls: { draftSlug: string; package?: ThemePackageV1 }[] = [];

    const saved = await saveBrandKitAuthoringState(
      current,
      async (draft, compiledPackage) => {
        calls.push({ draftSlug: draft.slug, package: compiledPackage });
        return {
          ok: true,
          draftId: "draft-1",
          packageId: compiledPackage.id,
          packageVersion: compiledPackage.version,
          package: compiledPackage,
          diagnostics: [],
        };
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.draftSlug, "saved-kit");
    assert.equal(calls[0]!.package?.id, "brand-kit:user-user-1:saved-kit");
    assert.equal(saved.saveResult?.ok, true);
    assert.equal(saved.saving, false);
  });

  test("save does not invoke persistence for invalid compiler output", async () => {
    const current = updateBrandKitTypography(state(), "body", "sizePt", "0");
    let called = false;

    const saved = await saveBrandKitAuthoringState(
      current,
      async (draft, pkg) => {
        void draft;
        void pkg;
        called = true;
        throw new Error("should not save invalid draft");
      },
    );

    assert.equal(called, false);
    assert.equal(saved.saveResult, undefined);
  });
});
