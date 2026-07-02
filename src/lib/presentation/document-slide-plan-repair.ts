import type { PresentationDiagnostic } from "./diagnostics";
import { makeDiagnostic } from "./diagnostics";
import type { SlotKey } from "./schema";
import { repairSemanticDeckPlan } from "./semantic-deck-plan-repair";
import type { DocumentSourcePlanV1 } from "./document-source-plan";
import type {
  DocumentPlannedSlideV1,
  DocumentSlideMode,
  DocumentSlidePlanV1,
} from "./document-slide-planner";
import { createDocumentSlidePlanTemplateRegistry } from "./document-slide-plan-templates";
import { uniqueStrings } from "./document-slide-plan-provenance";

export type DocumentSlidePlanRepairResult = {
  plan: DocumentSlidePlanV1;
  diagnostics: PresentationDiagnostic[];
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validMode(value: unknown): DocumentSlideMode {
  return value === "presentationRewrite" ? value : "faithful";
}

function sourceBlockIdSet(sourcePlan: DocumentSourcePlanV1): Set<string> {
  return new Set(
    sourcePlan.sections.flatMap((section) => section.sourceBlockIds),
  );
}

function filterSourceIds(
  ids: readonly string[],
  validIds: ReadonlySet<string>,
  diagnostics: PresentationDiagnostic[],
  path: string,
): string[] {
  const kept: string[] = [];
  for (const id of ids) {
    if (validIds.has(id)) {
      kept.push(id);
      continue;
    }
    diagnostics.push(
      makeDiagnostic(
        "missing-source-block",
        "warning",
        `Document slide plan referenced unknown source block "${id}".`,
        { path, details: { blockId: id } },
      ),
    );
  }
  return uniqueStrings(kept);
}

function readSlotSources(
  value: unknown,
  validIds: ReadonlySet<string>,
  diagnostics: PresentationDiagnostic[],
  slideIndex: number,
): Partial<Record<SlotKey, string[]>> {
  if (!isRecord(value)) return {};
  const slotSources: Partial<Record<SlotKey, string[]>> = {};
  for (const [slot, ids] of Object.entries(value)) {
    const filtered = filterSourceIds(
      readStringArray(ids),
      validIds,
      diagnostics,
      `slides[${slideIndex}].slotSources.${slot}`,
    );
    if (filtered.length > 0) {
      slotSources[slot as SlotKey] = filtered;
    }
  }
  return slotSources;
}

function semanticCandidateFromDocumentPlan(input: Record<string, unknown>) {
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  return {
    planVersion: input.planVersion,
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.locale === "string" ? { locale: input.locale } : {}),
    slides: rawSlides.map((slide) => {
      const raw = isRecord(slide) ? slide : {};
      const controls = isRecord(raw.controls) ? raw.controls : {};
      return {
        kind: raw.kind,
        tone: controls.tone,
        density: controls.density,
        emphasis: controls.emphasis,
        slots: raw.slots,
        speakerNotes: raw.speakerNotes,
      };
    }),
  };
}

export function repairDocumentSlidePlan({
  input,
  sourcePlan,
}: {
  input: unknown;
  sourcePlan: DocumentSourcePlanV1;
}): DocumentSlidePlanRepairResult {
  if (!isRecord(input)) {
    return {
      plan: {
        planVersion: 1,
        planner: "ai",
        mode: "faithful",
        source: {
          ...(sourcePlan.documentId
            ? { documentId: sourcePlan.documentId }
            : {}),
          contentHash: sourcePlan.contentHash,
          truncated: sourcePlan.truncated,
        },
        slides: [],
      },
      diagnostics: [
        makeDiagnostic(
          "invalid-schema-version",
          "fatal",
          "Document slide plan must be an object.",
        ),
      ],
    };
  }

  const semanticRepair = repairSemanticDeckPlan(
    semanticCandidateFromDocumentPlan(input),
    createDocumentSlidePlanTemplateRegistry(),
  );
  const diagnostics = [...semanticRepair.diagnostics];
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const validIds = sourceBlockIdSet(sourcePlan);
  const slides: DocumentPlannedSlideV1[] = [];

  for (let index = 0; index < semanticRepair.plan.slides.length; index++) {
    const semanticSlide = semanticRepair.plan.slides[index];
    const rawSlide = isRecord(rawSlides[index]) ? rawSlides[index] : {};
    const sourceBlockIds = filterSourceIds(
      readStringArray(rawSlide.sourceBlockIds),
      validIds,
      diagnostics,
      `slides[${index}].sourceBlockIds`,
    );
    const slotSources = readSlotSources(
      rawSlide.slotSources,
      validIds,
      diagnostics,
      index,
    );
    slides.push({
      id:
        typeof rawSlide.id === "string" && rawSlide.id.length > 0
          ? rawSlide.id
          : `plan-slide-${index + 1}`,
      kind: semanticSlide.kind,
      sourceBlockIds,
      slotSources,
      slots: semanticSlide.slots,
      ...((semanticSlide.tone ||
        semanticSlide.density ||
        semanticSlide.emphasis) && {
        controls: {
          ...(semanticSlide.tone ? { tone: semanticSlide.tone } : {}),
          ...(semanticSlide.density ? { density: semanticSlide.density } : {}),
          ...(semanticSlide.emphasis
            ? { emphasis: semanticSlide.emphasis }
            : {}),
        },
      }),
      ...(semanticSlide.speakerNotes
        ? { speakerNotes: semanticSlide.speakerNotes }
        : {}),
      ...(typeof rawSlide.rationale === "string"
        ? { rationale: rawSlide.rationale }
        : {}),
      ...(readStringArray(rawSlide.omittedBlockIds).length > 0
        ? {
            omittedBlockIds: filterSourceIds(
              readStringArray(rawSlide.omittedBlockIds),
              validIds,
              diagnostics,
              `slides[${index}].omittedBlockIds`,
            ),
          }
        : {}),
    });
  }

  return {
    plan: {
      planVersion: 1,
      planner: "ai",
      mode: validMode(input.mode),
      ...(semanticRepair.plan.title
        ? { title: semanticRepair.plan.title }
        : {}),
      ...(semanticRepair.plan.locale
        ? { locale: semanticRepair.plan.locale }
        : {}),
      source: {
        ...(sourcePlan.documentId ? { documentId: sourcePlan.documentId } : {}),
        contentHash: sourcePlan.contentHash,
        truncated: sourcePlan.truncated,
      },
      slides,
      ...(readStringArray(input.omittedBlockIds).length > 0
        ? {
            omittedBlockIds: filterSourceIds(
              readStringArray(input.omittedBlockIds),
              validIds,
              diagnostics,
              "omittedBlockIds",
            ),
          }
        : {}),
    },
    diagnostics,
  };
}
