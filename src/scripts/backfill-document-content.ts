import { pathToFileURL } from "node:url";

import { backfillDocumentContentProjection } from "@/lib/document/content-projection-backfill";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

type BackfillMainDeps = {
  backfill?: typeof backfillDocumentContentProjection;
  disconnect?: () => Promise<void>;
  info?: typeof logInfo;
  error?: typeof logError;
  setExitCode?: (code: number) => void;
};

export async function runBackfillDocumentContentMain(
  deps: BackfillMainDeps = {},
): Promise<void> {
  const backfill = deps.backfill ?? backfillDocumentContentProjection;
  const disconnect = deps.disconnect ?? (() => prisma.$disconnect());
  const info = deps.info ?? logInfo;
  const error = deps.error ?? logError;
  const setExitCode = deps.setExitCode ?? ((code) => (process.exitCode = code));

  try {
    const result = await backfill();
    info("document.content-projection.backfill", "backfill complete", result);
  } catch (cause) {
    error("document.content-projection.backfill", cause);
    setExitCode(1);
  } finally {
    await disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runBackfillDocumentContentMain().catch((error) => {
    logError("document.content-projection.backfill", error);
    process.exitCode = 1;
  });
}
