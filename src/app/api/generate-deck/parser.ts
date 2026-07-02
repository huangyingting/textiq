import { buildDeckSource } from "@/lib/ai/deck-source";
import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
  MAX_INPUT_CHARS,
} from "@/lib/ai/generate";
import type { DeckGenerationOptions } from "@/lib/ai/deck-generation-options";
import { ModelOutputBudgetError } from "@/lib/ai/generation-runner";
import {
  isPlainObject,
  type GenerationRouteErrorMapping,
  type PayloadParseResult,
} from "@/lib/ai/generation-route";
import {
  AI_OPTION_MAX_CHARS,
  formatAiOptionTooLongError,
  formatDeckInputTooLongError,
} from "@/lib/limits";
import { collectDocumentBlocks, type DocumentBlock } from "@/lib/content";
import {
  DEFAULT_THEME_PACKAGE_ID,
  isThemePackageId,
  type ThemePackageId,
} from "@/lib/presentation/theme-package-ids";
import type { Visual } from "@/lib/visual/schema";

const DECK_LENGTHS: readonly NonNullable<DeckGenerationOptions["length"]>[] = [
  "short",
  "medium",
  "long",
];

const DECK_MODES: readonly NonNullable<DeckGenerationOptions["mode"]>[] = [
  "faithful",
  "presentationRewrite",
];

export interface GenerateDeckPayload {
  contentJson: unknown;
  options: DeckGenerationOptions;
  blocks: ReadonlyArray<DocumentBlock>;
  visuals: Map<string, Visual>;
  outline: string;
  truncated: boolean;
  themePackageId: ThemePackageId;
}

export function visualsFromContent(
  blocks: ReadonlyArray<DocumentBlock>,
): Map<string, Visual> {
  const visuals = new Map<string, Visual>();
  for (const block of blocks) {
    if (block.kind === "visual") {
      visuals.set(block.visualId, block.visual);
    }
  }
  return visuals;
}

export function parseDeckOptions(
  value: unknown,
): { options: DeckGenerationOptions } | { error: string } {
  if (value === undefined || value === null) {
    return { options: {} };
  }
  if (!isPlainObject(value)) {
    return { error: "`options` must be an object." };
  }

  const options: DeckGenerationOptions = {};

  if (value.length !== undefined && value.length !== null) {
    if (
      !DECK_LENGTHS.includes(
        value.length as NonNullable<DeckGenerationOptions["length"]>,
      )
    ) {
      return {
        error: `\`options.length\` must be one of: ${DECK_LENGTHS.join(", ")}.`,
      };
    }
    options.length = value.length as DeckGenerationOptions["length"];
  }
  if (value.tone !== undefined && value.tone !== null) {
    if (typeof value.tone !== "string") {
      return { error: "`options.tone` must be a string." };
    }
    if (value.tone.length > AI_OPTION_MAX_CHARS) {
      return {
        error: formatAiOptionTooLongError("options.tone", value.tone.length),
      };
    }
    options.tone = value.tone;
  }
  if (value.audience !== undefined && value.audience !== null) {
    if (typeof value.audience !== "string") {
      return { error: "`options.audience` must be a string." };
    }
    if (value.audience.length > AI_OPTION_MAX_CHARS) {
      return {
        error: formatAiOptionTooLongError(
          "options.audience",
          value.audience.length,
        ),
      };
    }
    options.audience = value.audience;
  }
  if (value.mode !== undefined && value.mode !== null) {
    if (
      !DECK_MODES.includes(
        value.mode as NonNullable<DeckGenerationOptions["mode"]>,
      )
    ) {
      return {
        error: `\`options.mode\` must be one of: ${DECK_MODES.join(", ")}.`,
      };
    }
    options.mode = value.mode as DeckGenerationOptions["mode"];
  }

  return { options };
}

export function parseGenerateDeckPayload(
  body: Record<string, unknown>,
): PayloadParseResult<GenerateDeckPayload> {
  if (body.contentJson === undefined || body.contentJson === null) {
    return { ok: false, status: 400, message: "`contentJson` is required." };
  }

  const parsedOptions = parseDeckOptions(body.options);
  if ("error" in parsedOptions) {
    return { ok: false, status: 400, message: parsedOptions.error };
  }

  const blocks = collectDocumentBlocks(body.contentJson);
  const visuals = visualsFromContent(blocks);
  const { outline, truncated } = buildDeckSource(body.contentJson, visuals);
  if (outline.trim().length === 0)
    return {
      ok: false,
      status: 400,
      message: "`contentJson` does not contain any usable outline content.",
    };
  if (outline.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      status: 413,
      message: formatDeckInputTooLongError(outline.length),
    };
  }
  let themePackageId: ThemePackageId | undefined;
  if (body.themePackageId !== undefined && body.themePackageId !== null) {
    if (!isThemePackageId(body.themePackageId)) {
      return {
        ok: false,
        status: 400,
        message: "`themePackageId` is invalid.",
      };
    }
    themePackageId = body.themePackageId;
  } else {
    themePackageId = DEFAULT_THEME_PACKAGE_ID;
  }

  return {
    ok: true,
    payload: {
      contentJson: body.contentJson,
      options: parsedOptions.options,
      blocks,
      visuals,
      outline,
      truncated,
      themePackageId,
    },
  };
}

export function mapGenerateDeckError(
  error: unknown,
): GenerationRouteErrorMapping | null {
  if (error instanceof EmptyInputError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InputTooLongError) {
    return { status: 413, message: error.message };
  }
  if (error instanceof GenerationError)
    return {
      status: 502,
      message:
        "We couldn't generate a deck from that document. Please try again.",
      log: { reason: "generation-failed", status: 502 },
    };
  if (error instanceof ModelOutputBudgetError) {
    return {
      status: 502,
      message: "The AI response was too large. Please try again.",
      log: { reason: "model-output-budget", status: 502 },
    };
  }
  return null;
}
