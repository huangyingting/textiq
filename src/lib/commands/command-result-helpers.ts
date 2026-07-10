import type {
  DeckPatch,
  CommandResult as SlideCommandResult,
} from "@/lib/document/deck-kernel/slide-commands";
import type { CommandTarget } from "./envelope-core";

export interface CommandAffectedIds {
  documentIds: string[];
  visualIds: string[];
  slideIds: string[];
  elementIds: string[];
  assetIds: string[];
  commentIds: string[];
  sourceRefIds: string[];
  nodeIds: string[];
  edgeIds: string[];
}

export interface CrossSurfaceCommandResult<
  Patch = unknown,
  SideEffect = never,
> {
  ok: boolean;
  error?: string;
  affectedIds: CommandAffectedIds;
  coalesceKey?: string;
  patches: Patch[];
  sideEffects: SideEffect[];
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      seen.has(value)
    ) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function makeAffectedIds(
  partial: Partial<CommandAffectedIds> = {},
): CommandAffectedIds {
  return {
    documentIds: uniqueStrings(partial.documentIds),
    visualIds: uniqueStrings(partial.visualIds),
    slideIds: uniqueStrings(partial.slideIds),
    elementIds: uniqueStrings(partial.elementIds),
    assetIds: uniqueStrings(partial.assetIds),
    commentIds: uniqueStrings(partial.commentIds),
    sourceRefIds: uniqueStrings(partial.sourceRefIds),
    nodeIds: uniqueStrings(partial.nodeIds),
    edgeIds: uniqueStrings(partial.edgeIds),
  };
}

export function makeSideEffects<T extends { kind: string }>(
  ...effects: Array<T | false | null | undefined>
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const effect of effects) {
    if (!effect) {
      continue;
    }
    const key = JSON.stringify(effect);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(effect);
  }
  return result;
}

export function adaptSlideCommandResult(
  result: SlideCommandResult,
  target: Pick<CommandTarget, "documentId"> = {},
): CrossSurfaceCommandResult<DeckPatch> {
  return {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    affectedIds: makeAffectedIds({
      ...(target.documentId ? { documentIds: [target.documentId] } : {}),
      slideIds: result.affectedSlideIds,
      elementIds: result.affectedElementIds,
    }),
    ...(result.historyKey ? { coalesceKey: result.historyKey } : {}),
    patches: result.patches,
    /* node:coverage ignore next -- Empty side-effect normalization is asserted; tsx maps the literal tail as uncovered. */
    sideEffects: [],
  };
}
