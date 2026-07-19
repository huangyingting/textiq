---
type: "architecture"
status: "current"
last_updated: "2026-07-10"
description: "Describes AI visual and deck generation routes, shared validation and billing flow, deck source extraction, presentation deck orchestration, template materialization, output validation, UI flow, quota, credits, and invariants."
---

# AI Generation

This document describes the AI generation routes for visuals and decks. Both
routes use the same operational envelope: validate before any model call,
resolve Azure configuration, enforce quota/credits, run with an abort deadline,
validate/normalize output, and charge only successful generations.

## Source Files

| Area                   | Source                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Visual route           | [`src/app/api/generate/route.ts`](../../src/app/api/generate/route.ts)                                         |
| Deck route             | [`src/app/api/generate-deck/route.ts`](../../src/app/api/generate-deck/route.ts)                               |
| Azure client           | [`src/lib/ai/azure.ts`](../../src/lib/ai/azure.ts)                                                             |
| Deadline wrapper       | [`src/lib/ai/deadline.ts`](../../src/lib/ai/deadline.ts)                                                       |
| Visual generation core | [`src/lib/ai/generate.ts`](../../src/lib/ai/generate.ts)                                                       |
| Deck source extraction | [`src/lib/ai/deck-source.ts`](../../src/lib/ai/deck-source.ts)                                                 |
| Deck route logic       | [`src/app/api/generate-deck/route-logic.ts`](../../src/app/api/generate-deck/route-logic.ts)                   |
| Deck orchestration     | [`src/lib/ai/run-deck-generation.ts`](../../src/lib/ai/run-deck-generation.ts)                                 |
| Deck prompt            | [`src/lib/ai/deck-prompt.ts`](../../src/lib/ai/deck-prompt.ts)                                                 |
| Document plan repair   | [`src/lib/presentation/document-slide-plan.ts`](../../src/lib/presentation/document-slide-plan.ts)             |
| Semantic plan repair   | [`src/lib/presentation/semantic-deck-plan-repair.ts`](../../src/lib/presentation/semantic-deck-plan-repair.ts) |
| Template compiler      | [`src/lib/presentation/template-compiler.ts`](../../src/lib/presentation/template-compiler.ts)                 |
| Open-deck boundary     | [`src/lib/presentation/open-deck.ts`](../../src/lib/presentation/open-deck.ts)                                 |
| Deck schema validation | [`src/lib/presentation/validation.ts`](../../src/lib/presentation/validation.ts)                               |
| Quota                  | [`src/lib/ai/quota.ts`](../../src/lib/ai/quota.ts)                                                             |
| Credits                | [`src/lib/billing/credits.ts`](../../src/lib/billing/credits.ts)                                               |
| Usage ledger           | [`src/lib/billing/usage-ledger.ts`](../../src/lib/billing/usage-ledger.ts)                                     |

## Shared Route Flow

Both `/api/generate` and `/api/generate-deck` follow the same shape:

1. Parse JSON body.
2. Validate required input and option literals.
3. Reject oversized input before any model call.
4. Resolve Azure configuration; misconfiguration returns 503.
5. Identify the current user, if any.
6. Enforce anonymous quota or authenticated user rate limit.
7. Check credits and reserve usage for authenticated users.
8. Call Azure OpenAI through `withAbortDeadline`.
9. Validate/repair/normalize model output.
10. Capture usage and deduct credits on success; refund reservation on failure.

Status semantics are stable: 400 for bad request, 413 for oversized input, 429
for rate limit, 402 for insufficient credits, 502 for bad model output, 503 for
Azure config, and 504 for deadline timeout.

## Visual Generation

`POST /api/generate` accepts text plus optional visual tuning:

```json
{
  "text": "source text",
  "type": "flowchart",
  "orientation": "vertical",
  "detailLevel": "balanced",
  "stayCloserToText": true
}
```

The route calls `generateVisuals`, which asks the model for candidate visual
payloads and validates them against the current visual schema. The response is:

```json
{
  "candidates": [/* Visual[] */]
}
```

The route never writes document state. The caller applies the chosen visual to a
Lexical `VisualNode`; persistence happens later through the normal document
autosave and visual mirror pipeline.

## Deck Generation

`POST /api/generate-deck` accepts serialized Lexical `contentJson` and optional
deck tuning:

```json
{
  "contentJson": { "root": { "children": [] } },
  "options": { "length": "medium", "tone": "concise", "audience": "team" }
}
```

The route is gated by the deck-generation feature flag. When disabled, it
returns 404 before doing any work.

Deck generation does not accept a document id. It derives text blocks and visual
inventory directly from the supplied `contentJson`, so there is no cross-document
read and no document permission lookup inside the route.

The pure core is:

```text
contentJson + visuals
  -> buildDeckSource
  -> { outline, visualInventory, truncated }
  -> runDeckGeneration
   -> DocumentSourcePlanV1
   -> repairDocumentSlidePlan
   -> compileDocumentSlidePlanToDeck
  -> safeParseDeck
  -> { deck, truncated }
```

The model returns a `DocumentSlidePlanV1`: semantic template kinds, typed slot
content, source block ids, and slot-source mappings. The repair step validates
source ids and normalizes the semantic slide specs, then the shared document
slide plan compiler materializes editable Deck slide nodes with derivation
provenance. The final deck must pass `safeParseDeck` before it can open in
the editor.

Template text nodes are never left blank when a slot is absent. `compileSlide`
uses static template text when provided, otherwise it fills a readable fallback
derived from the node's slot or semantic role (`Title`, `Body text`, `Metric
label`, and similar) so generated preview decks remain inspectable before AI or
document content is applied.

Template materialization also maps local blueprint `zIndex` values into
type-based layer bands. By default, shape nodes render below media/table nodes,
connectors render above content objects, and text nodes render in the highest
content band so labels and copy remain visible over shapes and media unless a
user later changes z-order explicitly.

## UI Flow

The slide editor open button controls deck generation UI:

1. Capture the live Lexical state, falling back to the saved `contentJson` when
   the live editor is still seeding.
2. If no saved Deck exists and the document has usable content, build the
   deterministic baseline deck from that content before the editor opens.
3. If AI deck generation is enabled, show a chooser: generate with AI or derive
   from document.
4. Show staged progress while generation runs.
5. Present a preview/diff surface comparing generated deck vs baseline.
6. Applying the generated deck calls `openAiGeneratedDeck`, which routes through
   `openDeckFromJson` — the same open-deck boundary used by deterministic
   derivation. Both paths must pass `openDeckFromJson` validation before the
   editor runtime sees the deck.
7. Generation failure falls back to deterministic derivation, except empty
   content, which stays in the chooser with an "add content first" prompt.

## Quota And Credits

Anonymous callers receive a signed trial cookie plus a server-side hashed-IP
rate limit. Authenticated users are rate-limited by user id and charged credits
based on input size. Usage ledger reservation/capture/refund ensures failed
generations do not consume credits.

`isUnlimitedCreditsEnabled` bypasses credit deduction when enabled by
entitlements/configuration.

## Invariants

1. Input validation happens before Azure calls.
2. Azure misconfiguration never consumes quota or credits.
3. Authenticated credit usage is reserved before generation and captured only on
   success.
4. Deck output must pass current `safeParseDeck` before it reaches the editor.
5. Generated deck visuals may reference only the document visual inventory.
6. AI routes do not directly mutate documents.

## Primary Tests

- [`src/lib/ai/generate.test.ts`](../../src/lib/ai/generate.test.ts)
- [`src/lib/ai/deck-source.test.ts`](../../src/lib/ai/deck-source.test.ts)
- [`src/lib/ai/run-deck-generation.test.ts`](../../src/lib/ai/run-deck-generation.test.ts)
- [`src/lib/presentation/document-slide-plan.test.ts`](../../src/lib/presentation/document-slide-plan.test.ts)
- [`src/lib/ai/deck-generation-request.test.ts`](../../src/lib/ai/deck-generation-request.test.ts)
- [`src/lib/ai/quota.test.ts`](../../src/lib/ai/quota.test.ts)
- [`src/lib/billing/credits.test.ts`](../../src/lib/billing/credits.test.ts)
- [`src/lib/billing/usage-ledger.test.ts`](../../src/lib/billing/usage-ledger.test.ts)
