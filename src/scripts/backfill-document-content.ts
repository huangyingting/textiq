import { backfillDocumentContentProjection } from "@/lib/document/content-projection-backfill";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

async function main(): Promise<void> {
  const result = await backfillDocumentContentProjection();
  logInfo("document.content-projection.backfill", "backfill complete", result);
}

main()
  .catch((error) => {
    logError("document.content-projection.backfill", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
