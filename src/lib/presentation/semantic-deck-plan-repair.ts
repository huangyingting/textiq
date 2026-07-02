/**
 * AI plan repair for the presentation system.
 *
 * Validates an AI-generated plan and repairs it before template compilation:
 * - Validates/repairs template kinds and controls.
 * - Enforces slot capacity policies.
 * - Produces diagnostics for every material change.
 * - Never trusts AI-generated ids wholesale.
 */

import type {
  SemanticDeckPlanV1,
  SemanticSlideSpecV1,
  SlotValue,
  BulletSlotItem,
  MetricSlotItem,
  CardSlotItem,
  StepSlotItem,
  TimelineSlotItem,
} from "./semantic-deck-plan";
import type { SlotContract } from "./template-registry";
import type { PresentationDiagnostic } from "./diagnostics";
import { DiagnosticCollector } from "./diagnostics";
import {
  SemanticTemplateRegistry,
  isSemanticTemplateKind,
} from "./template-registry";
import type {
  SemanticTemplateKind,
  SlideTone,
  SlideDensity,
  SlideEmphasis,
  SlotKey,
} from "./schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TONES: SlideTone[] = [
  "neutral",
  "confident",
  "warm",
  "urgent",
  "premium",
  "technical",
];
const VALID_DENSITIES: SlideDensity[] = ["airy", "normal", "dense"];
const VALID_EMPHASIS: SlideEmphasis[] = [
  "balanced",
  "title",
  "data",
  "visual",
  "quote",
  "action",
];

function countCodePoints(s: string): number {
  let count = 0;
  for (const _ of s) count++;
  return count;
}

/** Normalises whitespace in a string for capacity counting. */
function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emitMalformedSlotDiagnostic(
  dc: DiagnosticCollector,
  path: string,
  message: string,
): void {
  dc.error("unknown-field", `${path}: ${message}`, { path });
}

function readRequiredString(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): string | undefined {
  if (typeof value === "string") return value;
  emitMalformedSlotDiagnostic(dc, path, "must be a string");
  return undefined;
}

function readOptionalString(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  emitMalformedSlotDiagnostic(dc, path, "must be a string");
  return undefined;
}

function readStringArray(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): string[] | undefined {
  if (!Array.isArray(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an array of strings");
    return undefined;
  }

  const parsed: string[] = [];
  let hasInvalid = false;
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") {
      hasInvalid = true;
      emitMalformedSlotDiagnostic(dc, `${path}[${i}]`, "must be a string");
      continue;
    }
    parsed.push(item);
  }
  return hasInvalid ? undefined : parsed;
}

function readStringMatrix(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): string[][] | undefined {
  if (!Array.isArray(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an array of string arrays");
    return undefined;
  }

  const parsed: string[][] = [];
  let hasInvalid = false;
  for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
    const row = value[rowIndex];
    if (!Array.isArray(row)) {
      hasInvalid = true;
      emitMalformedSlotDiagnostic(
        dc,
        `${path}[${rowIndex}]`,
        "must be an array of strings",
      );
      continue;
    }

    const parsedRow: string[] = [];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = row[colIndex];
      if (typeof cell !== "string") {
        hasInvalid = true;
        emitMalformedSlotDiagnostic(
          dc,
          `${path}[${rowIndex}][${colIndex}]`,
          "must be a string",
        );
        continue;
      }
      parsedRow.push(cell);
    }
    parsed.push(parsedRow);
  }

  return hasInvalid ? undefined : parsed;
}

function readArrayOf<T>(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
  parser: (
    item: unknown,
    itemPath: string,
    dc: DiagnosticCollector,
  ) => T | null,
): T[] | undefined {
  if (!Array.isArray(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an array");
    return undefined;
  }

  const parsed: T[] = [];
  let hasInvalid = false;
  for (let i = 0; i < value.length; i += 1) {
    const item = parser(value[i], `${path}[${i}]`, dc);
    if (item) {
      parsed.push(item);
    } else {
      hasInvalid = true;
    }
  }
  return hasInvalid ? undefined : parsed;
}

function readBulletItem(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): BulletSlotItem | null {
  if (!isRecord(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an object");
    return null;
  }

  const text = readRequiredString(value.text, `${path}.text`, dc);
  if (text === undefined) return null;

  let children: BulletSlotItem[] | undefined;
  if (value.children !== undefined) {
    const parsedChildren = readArrayOf(
      value.children,
      `${path}.children`,
      dc,
      readBulletItem,
    );
    if (parsedChildren !== undefined) {
      children = parsedChildren;
    }
  }

  return {
    text,
    ...(children !== undefined ? { children } : {}),
  };
}

function readMetricItem(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): MetricSlotItem | null {
  if (!isRecord(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an object");
    return null;
  }

  const metricValue = readRequiredString(value.value, `${path}.value`, dc);
  const label = readRequiredString(value.label, `${path}.label`, dc);
  if (metricValue === undefined || label === undefined) return null;

  const detail = readOptionalString(value.detail, `${path}.detail`, dc);
  return {
    value: metricValue,
    label,
    ...(detail !== undefined ? { detail } : {}),
  };
}

function readCardItem(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): CardSlotItem | null {
  if (!isRecord(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an object");
    return null;
  }

  const title = readRequiredString(value.title, `${path}.title`, dc);
  if (title === undefined) return null;

  const body = readOptionalString(value.body, `${path}.body`, dc);
  const metric = readOptionalString(value.metric, `${path}.metric`, dc);
  return {
    title,
    ...(body !== undefined ? { body } : {}),
    ...(metric !== undefined ? { metric } : {}),
  };
}

function readStepItem(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): StepSlotItem | null {
  if (!isRecord(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an object");
    return null;
  }

  const title = readRequiredString(value.title, `${path}.title`, dc);
  if (title === undefined) return null;

  const body = readOptionalString(value.body, `${path}.body`, dc);
  const date = readOptionalString(value.date, `${path}.date`, dc);
  return {
    title,
    ...(body !== undefined ? { body } : {}),
    ...(date !== undefined ? { date } : {}),
  };
}

function readTimelineItem(
  value: unknown,
  path: string,
  dc: DiagnosticCollector,
): TimelineSlotItem | null {
  if (!isRecord(value)) {
    emitMalformedSlotDiagnostic(dc, path, "must be an object");
    return null;
  }

  const label = readRequiredString(value.label, `${path}.label`, dc);
  const title = readRequiredString(value.title, `${path}.title`, dc);
  if (label === undefined || title === undefined) return null;

  const body = readOptionalString(value.body, `${path}.body`, dc);
  return {
    label,
    title,
    ...(body !== undefined ? { body } : {}),
  };
}

function validateSlotValue(
  slotKey: SlotKey,
  slotValue: unknown,
  contract: SlotContract | undefined,
  dc: DiagnosticCollector,
  slideIndex: number,
): SlotValue | undefined {
  const ctx = `slides[${slideIndex}].slots.${slotKey}`;

  if (!isRecord(slotValue)) {
    emitMalformedSlotDiagnostic(dc, ctx, "must be an object");
    return undefined;
  }

  const type = slotValue.type;
  if (typeof type !== "string") {
    emitMalformedSlotDiagnostic(dc, `${ctx}.type`, "must be a string");
    return undefined;
  }

  let validated: SlotValue | undefined;
  if (type === "shortText") {
    const text = readRequiredString(slotValue.text, `${ctx}.text`, dc);
    if (text !== undefined) validated = { type: "shortText", text };
  } else if (type === "paragraph") {
    const paragraphs = readStringArray(
      slotValue.paragraphs,
      `${ctx}.paragraphs`,
      dc,
    );
    if (paragraphs !== undefined) validated = { type: "paragraph", paragraphs };
  } else if (type === "bullets") {
    const items = readArrayOf(
      slotValue.items,
      `${ctx}.items`,
      dc,
      readBulletItem,
    );
    if (items !== undefined) validated = { type: "bullets", items };
  } else if (type === "metric") {
    const metricValue = readRequiredString(slotValue.value, `${ctx}.value`, dc);
    const label = readRequiredString(slotValue.label, `${ctx}.label`, dc);
    if (metricValue !== undefined && label !== undefined) {
      const detail = readOptionalString(slotValue.detail, `${ctx}.detail`, dc);
      validated = {
        type: "metric",
        value: metricValue,
        label,
        ...(detail !== undefined ? { detail } : {}),
      };
    }
  } else if (type === "metrics") {
    const items = readArrayOf(
      slotValue.items,
      `${ctx}.items`,
      dc,
      readMetricItem,
    );
    if (items !== undefined) validated = { type: "metrics", items };
  } else if (type === "cards") {
    const items = readArrayOf(
      slotValue.items,
      `${ctx}.items`,
      dc,
      readCardItem,
    );
    if (items !== undefined) validated = { type: "cards", items };
  } else if (type === "steps") {
    const items = readArrayOf(
      slotValue.items,
      `${ctx}.items`,
      dc,
      readStepItem,
    );
    if (items !== undefined) validated = { type: "steps", items };
  } else if (type === "image") {
    const hasAnyField =
      "assetId" in slotValue || "prompt" in slotValue || "alt" in slotValue;
    const assetId = readOptionalString(slotValue.assetId, `${ctx}.assetId`, dc);
    const prompt = readOptionalString(slotValue.prompt, `${ctx}.prompt`, dc);
    const alt = readOptionalString(slotValue.alt, `${ctx}.alt`, dc);
    if (
      hasAnyField &&
      assetId === undefined &&
      prompt === undefined &&
      alt === undefined
    ) {
      return undefined;
    }
    validated = {
      type: "image",
      ...(assetId !== undefined ? { assetId } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(alt !== undefined ? { alt } : {}),
    };
  } else if (type === "table") {
    const columns = readStringArray(slotValue.columns, `${ctx}.columns`, dc);
    const rows = readStringMatrix(slotValue.rows, `${ctx}.rows`, dc);
    if (columns !== undefined && rows !== undefined) {
      const caption = readOptionalString(
        slotValue.caption,
        `${ctx}.caption`,
        dc,
      );
      validated = {
        type: "table",
        columns,
        rows,
        ...(caption !== undefined ? { caption } : {}),
      };
    }
  } else if (type === "timeline") {
    const items = readArrayOf(
      slotValue.items,
      `${ctx}.items`,
      dc,
      readTimelineItem,
    );
    if (items !== undefined) validated = { type: "timeline", items };
  } else if (type === "visual") {
    const visualId = readRequiredString(
      slotValue.visualId,
      `${ctx}.visualId`,
      dc,
    );
    if (visualId !== undefined) {
      const caption = readOptionalString(
        slotValue.caption,
        `${ctx}.caption`,
        dc,
      );
      validated = {
        type: "visual",
        visualId,
        ...(caption !== undefined ? { caption } : {}),
      };
    }
  } else {
    emitMalformedSlotDiagnostic(
      dc,
      `${ctx}.type`,
      `unsupported slot value type "${type}"`,
    );
    return undefined;
  }

  if (validated === undefined) return undefined;

  if (contract && validated.type !== contract.type) {
    dc.error(
      "unknown-field",
      `${ctx}.type "${validated.type}" does not match template contract type "${contract.type}"`,
      { path: `${ctx}.type` },
    );
    return undefined;
  }

  return validated;
}

// ---------------------------------------------------------------------------
// Slot value repair
// ---------------------------------------------------------------------------

function repairSlotValue(
  slotKey: SlotKey,
  value: SlotValue,
  contract: SlotContract,
  dc: DiagnosticCollector,
  slideIndex: number,
): SlotValue | undefined {
  const ctx = `slides[${slideIndex}].slots.${slotKey}`;

  // Text capacity
  if (value.type === "shortText") {
    const norm = normaliseWhitespace(value.text);
    if (contract.maxChars && countCodePoints(norm) > contract.maxChars) {
      const truncated = [...norm]
        .slice(0, contract.maxChars)
        .join("")
        .trimEnd();
      dc.warning(
        "slot-over-capacity",
        `${ctx}: text truncated from ${countCodePoints(norm)} to ${contract.maxChars} chars`,
        { path: ctx },
      );
      return { type: "shortText", text: truncated };
    }
    return { type: "shortText", text: norm };
  }

  if (value.type === "paragraph") {
    let paragraphs = value.paragraphs;
    if (contract.maxItems && paragraphs.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: paragraph count ${paragraphs.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      paragraphs = paragraphs.slice(0, contract.maxItems);
    }
    return { type: "paragraph", paragraphs };
  }

  if (value.type === "bullets") {
    let items = value.items;
    if (contract.maxItems && items.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: bullet count ${items.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      items = items.slice(0, contract.maxItems);
    }
    return { type: "bullets", items };
  }

  if (value.type === "metrics") {
    let items = value.items;
    if (contract.maxItems && items.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: metrics count ${items.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      items = items.slice(0, contract.maxItems);
    }
    return { type: "metrics", items };
  }

  if (value.type === "cards") {
    let items = value.items;
    if (contract.maxItems && items.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: cards count ${items.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      items = items.slice(0, contract.maxItems);
    }
    return { type: "cards", items };
  }

  if (value.type === "steps") {
    let items = value.items;
    if (contract.maxItems && items.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: steps count ${items.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      items = items.slice(0, contract.maxItems);
    }
    return { type: "steps", items };
  }

  if (value.type === "timeline") {
    let items = value.items;
    if (contract.maxItems && items.length > contract.maxItems) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: timeline count ${items.length} exceeds max ${contract.maxItems}; truncating`,
        { path: ctx },
      );
      items = items.slice(0, contract.maxItems);
    }
    return { type: "timeline", items };
  }

  if (value.type === "table") {
    let { columns, rows } = value;
    const { caption } = value;
    if (contract.maxColumns && columns.length > contract.maxColumns) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: table columns ${columns.length} exceeds max ${contract.maxColumns}; truncating`,
        { path: ctx },
      );
      columns = columns.slice(0, contract.maxColumns);
      rows = rows.map((row) => row.slice(0, contract.maxColumns!));
    }
    if (contract.maxRows && rows.length > contract.maxRows) {
      dc.warning(
        "slot-over-capacity",
        `${ctx}: table rows ${rows.length} exceeds max ${contract.maxRows}; truncating`,
        { path: ctx },
      );
      rows = rows.slice(0, contract.maxRows);
    }
    return { type: "table", columns, rows, ...(caption ? { caption } : {}) };
  }

  return value;
}

// ---------------------------------------------------------------------------
// Slide repair
// ---------------------------------------------------------------------------

function repairSlide(
  slide: unknown,
  index: number,
  registry: SemanticTemplateRegistry,
  dc: DiagnosticCollector,
): SemanticSlideSpecV1 | null {
  const ctx = `slides[${index}]`;

  if (typeof slide !== "object" || slide === null) {
    dc.error("unknown-template-kind", `${ctx} must be an object`);
    return null;
  }

  const s = slide as Record<string, unknown>;

  // Repair kind
  let kind: SemanticTemplateKind;
  if (!isSemanticTemplateKind(s.kind)) {
    // Try to map to nearest known kind
    dc.warning(
      "unknown-template-kind",
      `${ctx}.kind "${s.kind}" is unknown; defaulting to "content"`,
      { path: `${ctx}.kind` },
    );
    kind = "content";
  } else {
    kind = s.kind as SemanticTemplateKind;
  }

  // Repair tone
  let tone: SlideTone | undefined;
  if (s.tone !== undefined) {
    if (!VALID_TONES.includes(s.tone as SlideTone)) {
      dc.warning(
        "unsupported-template-control",
        `${ctx}.tone "${s.tone}" is unknown; removing`,
        { path: `${ctx}.tone` },
      );
    } else {
      tone = s.tone as SlideTone;
    }
  }

  // Repair density
  let density: SlideDensity | undefined;
  if (s.density !== undefined) {
    if (!VALID_DENSITIES.includes(s.density as SlideDensity)) {
      dc.warning(
        "unsupported-template-control",
        `${ctx}.density "${s.density}" is unknown; removing`,
        { path: `${ctx}.density` },
      );
    } else {
      density = s.density as SlideDensity;
    }
  }

  // Repair emphasis
  let emphasis: SlideEmphasis | undefined;
  if (s.emphasis !== undefined) {
    if (!VALID_EMPHASIS.includes(s.emphasis as SlideEmphasis)) {
      dc.warning(
        "unsupported-template-control",
        `${ctx}.emphasis "${s.emphasis}" is unknown; removing`,
        { path: `${ctx}.emphasis` },
      );
    } else {
      emphasis = s.emphasis as SlideEmphasis;
    }
  }

  // Repair slots
  const rawSlots =
    s.slots && typeof s.slots === "object" && !Array.isArray(s.slots)
      ? (s.slots as Record<string, unknown>)
      : {};

  const template = registry.get(kind);
  const repairedSlots: Partial<Record<SlotKey, SlotValue>> = {};

  for (const [slotKey, slotValue] of Object.entries(rawSlots)) {
    const contract = template?.slots[slotKey as SlotKey];
    const validated = validateSlotValue(
      slotKey as SlotKey,
      slotValue,
      contract,
      dc,
      index,
    );
    if (!validated) continue;

    if (!contract) {
      // Slot not in template — include validated value as-is
      repairedSlots[slotKey as SlotKey] = validated;
      continue;
    }

    const repaired = repairSlotValue(
      slotKey as SlotKey,
      validated,
      contract,
      dc,
      index,
    );
    if (repaired !== undefined) {
      repairedSlots[slotKey as SlotKey] = repaired;
    }
  }

  // Check required slots
  if (template) {
    for (const [slotKey, contract] of Object.entries(template.slots)) {
      if (contract.required && !(slotKey in repairedSlots)) {
        dc.error(
          "missing-required-slot",
          `${ctx}: required slot "${slotKey}" is missing`,
          { path: `${ctx}.slots.${slotKey}` },
        );
      }
    }
  }

  const speakerNotes =
    typeof s.speakerNotes === "string" ? s.speakerNotes : undefined;

  return {
    kind,
    ...(tone !== undefined ? { tone } : {}),
    ...(density !== undefined ? { density } : {}),
    ...(emphasis !== undefined ? { emphasis } : {}),
    slots: repairedSlots,
    ...(speakerNotes !== undefined ? { speakerNotes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SemanticDeckPlanRepairResult = {
  plan: SemanticDeckPlanV1;
  diagnostics: PresentationDiagnostic[];
};

/**
 * Validates and repairs an AI-generated deck plan.
 *
 * - Validates plan structure (planVersion, slides array).
 * - Repairs unknown template kinds to "content" with a warning.
 * - Repairs unknown controls (tone/density/emphasis) by removing them.
 * - Enforces slot capacity policies from the template registry.
 * - Checks required slots and emits errors for missing ones.
 * - Emits diagnostics for every material change.
 *
 * The returned plan is safe to pass to the template compiler.
 */
export function repairSemanticDeckPlan(
  input: unknown,
  registry: SemanticTemplateRegistry,
): SemanticDeckPlanRepairResult {
  const dc = new DiagnosticCollector();

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    dc.fatal("invalid-schema-version", "AI deck plan must be an object");
    return {
      plan: { planVersion: 1, slides: [] },
      diagnostics: dc.diagnostics,
    };
  }

  const p = input as Record<string, unknown>;

  if (p.planVersion !== 1) {
    dc.fatal(
      "invalid-schema-version",
      `AI deck plan planVersion must be 1 (got ${p.planVersion})`,
    );
    return {
      plan: { planVersion: 1, slides: [] },
      diagnostics: dc.diagnostics,
    };
  }

  if (!Array.isArray(p.slides)) {
    dc.error("unknown-field", "AI deck plan slides must be an array");
    return {
      plan: { planVersion: 1, slides: [] },
      diagnostics: dc.diagnostics,
    };
  }

  const repairedSlides: SemanticSlideSpecV1[] = [];
  for (let i = 0; i < p.slides.length; i++) {
    const repaired = repairSlide(p.slides[i], i, registry, dc);
    if (repaired !== null) {
      repairedSlides.push(repaired);
    }
  }

  return {
    plan: {
      planVersion: 1,
      ...(typeof p.title === "string" ? { title: p.title } : {}),
      ...(typeof p.locale === "string" ? { locale: p.locale } : {}),
      slides: repairedSlides,
    },
    diagnostics: dc.diagnostics,
  };
}
