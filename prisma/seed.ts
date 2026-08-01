import "dotenv/config";

import { Prisma } from "../src/generated/prisma/client";
import { markdownToLexicalStateObject } from "../src/lib/content/from-markdown";
import { createDocumentWithCanonicalContent } from "../src/lib/document/document-write-port";
import { buildSeedContentJson } from "../src/lib/lexical/seed-content";
import { syncSeededDemoDocument } from "../src/lib/onboarding/seed-demo-document-state";
import { FIXTURES } from "../src/lib/visual/fixtures";
import {
  VISUAL_KIND_TO_PRISMA,
  safeParseVisual,
} from "../src/lib/visual/schema";
import { createScriptPrismaClient } from "./script-prisma-client";

const prisma = createScriptPrismaClient();

async function main() {
  const initialDocumentContent =
    "Paste your text here, then generate a flowchart, mind map, or chart.";
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@textiq.test" },
    update: {},
    create: {
      email: "demo@textiq.test",
      name: "Demo User",
    },
  });

  const existingDocument = await prisma.document.findFirst({
    where: { ownerId: demoUser.id, title: "Welcome to TextIQ" },
  });

  const demoDocument =
    existingDocument ??
    (await createDocumentWithCanonicalContent<{
      id: string;
      title: string;
    }>(prisma, {
      contentSnapshot: markdownToLexicalStateObject(initialDocumentContent),
      data: {
        title: "Welcome to TextIQ",
        ownerId: demoUser.id,
      },
    }));

  // Seed a sample visual with Json `data` so SQLite's Json -> TEXT mapping is
  // exercised end to end. One active visual per document (mirrors attachVisual):
  // find-or-create by documentId keeps the seed idempotent across re-runs and
  // `migrate reset`.
  const sampleVisual = FIXTURES.flowchart;
  const visualData = sampleVisual as unknown as Prisma.InputJsonValue;

  const existingVisual = await prisma.visual.findFirst({
    where: { documentId: demoDocument.id },
    orderBy: { createdAt: "asc" },
  });

  const demoVisual = existingVisual
    ? await prisma.visual.update({
        where: { id: existingVisual.id },
        data: {
          type: VISUAL_KIND_TO_PRISMA[sampleVisual.type],
          title: sampleVisual.title ?? null,
          data: visualData,
        },
      })
    : await prisma.visual.create({
        data: {
          documentId: demoDocument.id,
          type: VISUAL_KIND_TO_PRISMA[sampleVisual.type],
          title: sampleVisual.title ?? null,
          data: visualData,
        },
      });

  // Read the row back through the client and re-validate the Json payload so a
  // broken Json round-trip (e.g. on SQLite) fails the seed loudly.
  const readBack = await prisma.visual.findUniqueOrThrow({
    where: { id: demoVisual.id },
  });
  const parsed = safeParseVisual(readBack.data);
  if (!parsed.success) {
    throw new Error(`Seeded visual failed to read back: ${parsed.error}`);
  }

  // Embed the demo visual as a VisualNode decorator in the document's Lexical
  // editor state so first-run users see the flowchart inline immediately.
  // Always update so the contentJson stays in sync with the Visual row even on
  // repeated `migrate reset` runs (idempotent by design).
  const contentJsonValue = buildSeedContentJson(
    "Welcome! Here is a sample flowchart — click it to edit, restyle, or regenerate.",
    parsed.data,
    demoVisual.id,
  ) as unknown as Prisma.InputJsonValue;

  await syncSeededDemoDocument(prisma, {
    documentId: demoDocument.id,
    contentSnapshot: contentJsonValue,
  });

  console.log(
    `Seeded user "${demoUser.email}", document "${demoDocument.title}" ` +
      `(contentJson includes VisualNode for visual ${demoVisual.id}), ` +
      `and ${readBack.type} visual ("${parsed.data.type}", ` +
      `${parsed.data.nodes.length} nodes).`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
