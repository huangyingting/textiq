import type { DocumentBlock } from "@/lib/content";

import type { PresentationDiagnostic } from "./diagnostics";
import { createBlankDeckV7 } from "./empty-deck";
import type { DeckV7, SlideNode } from "./schema";
import { DECK_SCHEMA_VERSION_V7 } from "./schema";
import type { CanvasSpec } from "./types";
import { compileSlide } from "./template-compiler";
import { safeParseDeckV7 } from "./validation";
import {
  documentSlidePlanToSemanticDeckPlan,
  type DocumentSlidePlanV1,
} from "./document-slide-planner";
import { createDocumentSlidePlanTemplateRegistry } from "./document-slide-plan-templates";
import {
  stampSlideSources,
  uniqueStrings,
} from "./document-slide-plan-provenance";
import { buildDeckDerivationExtra } from "./provenance-extra";

export type CompileDocumentSlidePlanResult =
  | {
      ok: true;
      deck: DeckV7;
      diagnostics: PresentationDiagnostic[];
    }
  | {
      ok: false;
      error: string;
      diagnostics: PresentationDiagnostic[];
      validationErrors?: string[];
    };
export function compileDocumentSlidePlanToDeckV7({
  plan,
  blockMap,
  linkedAt = new Date().toISOString(),
  themePackageId = "neutral",
  canvas,
}: {
  plan: DocumentSlidePlanV1;
  blockMap: ReadonlyMap<string, DocumentBlock>;
  linkedAt?: string;
  themePackageId?: string;
  canvas?: CanvasSpec;
}): CompileDocumentSlidePlanResult {
  try {
    const diagnostics: PresentationDiagnostic[] = [];
    const slides: SlideNode[] = [];
    const semanticPlan = documentSlidePlanToSemanticDeckPlan(plan);
    const templateRegistry = createDocumentSlidePlanTemplateRegistry();

    for (let i = 0; i < semanticPlan.slides.length; i++) {
      const spec = semanticPlan.slides[i];
      const slidePlan = plan.slides[i];
      if (!spec || !slidePlan) continue;
      const template = templateRegistry.get(spec.kind);
      if (!template) continue;
      const compiled = compileSlide(spec, template, slides.length);
      diagnostics.push(...compiled.diagnostics);
      slides.push(
        stampSlideSources(
          compiled.slide,
          slidePlan,
          blockMap,
          plan.source.documentId,
          linkedAt,
        ),
      );
    }

    if (slides.length === 0) {
      return {
        ok: true,
        deck: createBlankDeckV7({ documentId: plan.source.documentId }),
        diagnostics,
      };
    }

    const sourceBlockIds = uniqueStrings(
      plan.slides.flatMap((slide) => slide.sourceBlockIds),
    );
    const omittedBlockIds = uniqueStrings([
      ...(plan.omittedBlockIds ?? []),
      ...plan.slides.flatMap((slide) => slide.omittedBlockIds ?? []),
    ]);
    const candidateDeck: DeckV7 = {
      schemaVersion: DECK_SCHEMA_VERSION_V7,
      canvas: canvas ?? {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
      },
      theme: { packageId: themePackageId || "neutral" },
      assets: { images: {} },
      slides,
      ...(plan.title ? { title: plan.title } : {}),
      metadata: {
        createdAt: linkedAt,
        updatedAt: linkedAt,
        ...(plan.source.documentId
          ? { sourceDocumentId: plan.source.documentId }
          : {}),
        contentHash: plan.source.contentHash,
        ...(plan.locale ? { locale: plan.locale } : {}),
        extra: {
          derivation: buildDeckDerivationExtra({
            planner: plan.planner,
            mode: plan.mode,
            ...(plan.source.documentId
              ? { sourceDocumentId: plan.source.documentId }
              : {}),
            sourceContentHash: plan.source.contentHash,
            sourceBlockIds,
            omittedBlockIds,
            generatedAt: linkedAt,
          }),
        },
      },
    };

    const parsed = safeParseDeckV7(candidateDeck);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Derived deck failed v7 validation: ${parsed.errors.join("; ")}`,
        diagnostics,
        validationErrors: parsed.errors,
      };
    }

    return { ok: true, deck: parsed.data, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      ok: false,
      error: `Could not compile document slide plan: ${message}`,
      diagnostics: [],
    };
  }
}
