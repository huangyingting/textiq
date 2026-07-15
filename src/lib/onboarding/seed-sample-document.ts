import { Prisma } from "@/generated/prisma/client";
import { projectDocumentContent } from "@/lib/document/content-projection";
import { generateBlockId } from "@/lib/lexical/block-id";
import { buildSeedContentJson } from "@/lib/lexical/seed-content";
import { prisma } from "@/lib/prisma";
import { FIXTURES } from "@/lib/visual/fixtures";
import { VISUAL_KIND_TO_PRISMA } from "@/lib/visual/schema";

/** Title of the first-run sample document seeded for new users. */
const SAMPLE_DOCUMENT_TITLE = "Welcome to TextIQ";

/**
 * Example Markdown for the first-run sample document. Uses the block kinds the
 * editor supports (headings, paragraphs, bullet lists, and tables) and keeps
 * blocks blank-line separated so Markdown import renders them distinctly.
 */
const SAMPLE_DOCUMENT_CONTENT = `# Welcome to TextIQ

TextIQ is a workspace for turning messy source material into clear documents, visuals, and presentation-ready slides. Start with notes, outlines, research, or meeting transcripts; then shape them into something your team can read, discuss, and share.

TextIQ keeps writing, visual thinking, and deck creation in one flow. You can draft in the document editor, generate diagrams from selected text, organize evidence in tables, and open the slide editor when the story is ready.

## What you can build

- Structured briefs with headings, sections, and reusable source blocks
- Flowcharts, mind maps, matrices, and other editable visuals
- Tables for comparing decisions, risks, owners, and next steps
- Slide decks generated from the same document context

## Example workflow

- Capture the raw thinking in this document
- Highlight a section and generate a visual from it
- Use tables to keep responsibilities and evidence concrete
- Open the slide editor to turn the document into a deck

### Where TextIQ helps

| Need | TextIQ surface | What it does |
| --- | --- | --- |
| Explain a process | Visuals | Converts selected text into an editable flowchart or diagram |
| Compare options | Tables | Keeps criteria, owners, and status in a scannable structure |
| Prepare a meeting | Slides | Builds a presentation from the document and visual inventory |
| Share progress | Public links | Publishes a read-only document or deck with controlled access |

## Try it yourself

Edit this document, add another heading, or change the table. The editable visual below is attached to the document, so you can select it, restyle it, regenerate it, or use it as source material for a deck.`;

function toPrismaJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

type SeedSampleDocumentDb = Pick<typeof prisma, "document">;

/**
 * Seeds a single first-run sample document (with one pre-attached visual) for a
 * brand-new user.
 *
 * Idempotent and guarded: it only seeds when the user has no documents at all,
 * so an existing user is never re-seeded and a user gets at most one sample,
 * even if this runs more than once. It is also best-effort — any failure is
 * swallowed (and logged) so a seeding hiccup can never block sign-up or first
 * login.
 */
export async function seedSampleDocument(
  userId: string,
  db: SeedSampleDocumentDb = prisma,
): Promise<void> {
  try {
    // Guard: never re-seed a user who already has documents (existing accounts
    // or a previous seed). Include soft-deleted rows so a user who deleted the
    // sample is not re-seeded.
    const existing = await db.document.findFirst({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const sampleVisual = FIXTURES.flowchart;
    const visualId = generateBlockId();

    await db.document.create({
      data: {
        title: SAMPLE_DOCUMENT_TITLE,
        ...projectDocumentContent(
          buildSeedContentJson(SAMPLE_DOCUMENT_CONTENT, sampleVisual, visualId),
        ),
        ownerId: userId,
        visuals: {
          create: {
            anchorBlockId: visualId,
            type: VISUAL_KIND_TO_PRISMA[sampleVisual.type],
            title: sampleVisual.title ?? null,
            data: toPrismaJsonInput(sampleVisual),
          },
        },
      },
    });
  } catch (error) {
    // Seeding is a nice-to-have; never let it break authentication.
    console.error("Failed to seed first-run sample document", error);
  }
}
