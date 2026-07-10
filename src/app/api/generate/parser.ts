import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
} from "@/lib/ai/generate";
import type {
  GenerationRouteErrorMapping,
  PayloadParseResult,
} from "@/lib/ai/generation-route";
import { ModelOutputBudgetError } from "@/lib/ai/generation-runner";
import {
  DETAIL_LEVELS,
  ORIENTATIONS,
  isDetailLevel,
  isOrientation,
  type DetailLevel,
  type Orientation,
} from "@/lib/ai/prompt";
import {
  formatVisualInputTooLongError,
  AI_GENERATION_INPUT_MAX_CHARS,
} from "@/lib/limits";
import { VISUAL_KINDS, isVisualKind } from "@/lib/visual/schema";
import type { VisualKind } from "@/lib/visual/schema";

export interface GeneratePayload {
  text: string;
  type?: VisualKind;
  orientation?: Orientation;
  detailLevel?: DetailLevel;
  stayCloserToText?: boolean;
}

export function parseGeneratePayload(
  body: Record<string, unknown>,
): PayloadParseResult<GeneratePayload> {
  const text = typeof body.text === "string" ? body.text : "";
  if (text.trim().length === 0) {
    return { ok: false, status: 400, message: "`text` is required." };
  }
  if (text.length > AI_GENERATION_INPUT_MAX_CHARS) {
    return {
      ok: false,
      status: 413,
      message: formatVisualInputTooLongError(text.length),
    };
  }

  let type: VisualKind | undefined;
  if (body.type !== undefined && body.type !== null) {
    if (!isVisualKind(body.type)) {
      return {
        ok: false,
        status: 400,
        message: `\`type\` must be one of: ${VISUAL_KINDS.join(", ")}.`,
      };
    }
    type = body.type;
  }

  let orientation: Orientation | undefined;
  if (body.orientation !== undefined && body.orientation !== null) {
    if (!isOrientation(body.orientation)) {
      return {
        ok: false,
        status: 400,
        message: `\`orientation\` must be one of: ${ORIENTATIONS.join(", ")}.`,
      };
    }
    orientation = body.orientation;
  }

  let detailLevel: DetailLevel | undefined;
  if (body.detailLevel !== undefined && body.detailLevel !== null) {
    if (!isDetailLevel(body.detailLevel)) {
      return {
        ok: false,
        status: 400,
        message: `\`detailLevel\` must be one of: ${DETAIL_LEVELS.join(", ")}.`,
      };
    }
    detailLevel = body.detailLevel;
  }

  const stayCloserToText = body.stayCloserToText === true ? true : undefined;

  return {
    ok: true,
    payload: { text, type, orientation, detailLevel, stayCloserToText },
  };
}

export function mapGenerateError(
  error: unknown,
): GenerationRouteErrorMapping | null {
  if (error instanceof EmptyInputError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InputTooLongError) {
    return { status: 413, message: error.message };
  }
  if (error instanceof GenerationError) {
    return {
      status: 502,
      message: "We couldn't generate visuals from that text. Please try again.",
      log: { reason: "generation-failed", status: 502 },
    };
  }
  if (error instanceof ModelOutputBudgetError) {
    return {
      status: 502,
      message: "The AI response was too large. Please try again.",
      log: { reason: "model-output-budget", status: 502 },
    };
  }
  return null;
}
