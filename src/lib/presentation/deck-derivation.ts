import type { PresentationDiagnostic } from "./diagnostics";
import { createBlankDeck } from "./empty-deck";
import type { Deck } from "./schema";
import {
  buildDocumentSourcePlanV1,
  compileDocumentSlidePlanToDeck,
  deriveDocumentSlidePlanDeterministic,
} from "./document-slide-plan";

export type DeriveDeckResult =
  | {
      ok: true;
      deck: Deck;
      diagnostics: PresentationDiagnostic[];
    }
  | {
      ok: false;
      error: string;
      diagnostics: PresentationDiagnostic[];
      validationErrors?: string[];
    };

export function deriveDeckFromDocumentContent({
  contentJson,
  documentId,
  linkedAt = new Date().toISOString(),
  themePackageId = "neutral",
}: {
  contentJson: unknown;
  documentId?: string;
  linkedAt?: string;
  themePackageId?: string;
}): DeriveDeckResult {
  const fallbackDeck = createBlankDeck({ documentId });
  const source = buildDocumentSourcePlanV1({ contentJson, documentId });
  if (source.blocks.length === 0) {
    return { ok: true, deck: fallbackDeck, diagnostics: [] };
  }

  const plan = deriveDocumentSlidePlanDeterministic(source);
  if (plan.slides.length === 0) {
    return { ok: true, deck: fallbackDeck, diagnostics: [] };
  }

  const compiled = compileDocumentSlidePlanToDeck({
    plan,
    blockMap: source.blockMap,
    linkedAt,
    themePackageId,
  });
  if (!compiled.ok) {
    return {
      ok: false,
      error: compiled.error,
      diagnostics: compiled.diagnostics,
      validationErrors: compiled.validationErrors,
    };
  }
  return compiled;
}
