import { pathToFileURL } from "node:url";

import {
  CONTENT_PROJECTION_BACKFILL_DEFAULT_BATCH_SIZE,
  CONTENT_PROJECTION_BACKFILL_DEFAULT_RETRIES,
  CONTENT_PROJECTION_BACKFILL_DEFAULT_SAMPLE_LIMIT,
  CONTENT_PROJECTION_BACKFILL_MAX_BATCH_SIZE,
  CONTENT_PROJECTION_BACKFILL_MAX_RETRIES,
  CONTENT_PROJECTION_BACKFILL_MAX_SAMPLE_LIMIT,
  backfillDocumentContentProjection,
  type ContentProjectionBackfillOptions,
} from "@/lib/document/content-projection-backfill";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

const EXECUTE_CONFIRM_VALUE = "write-projections";
type BackfillEnvironment = Readonly<Record<string, string | undefined>>;

type BackfillMainDeps = {
  backfill?: typeof backfillDocumentContentProjection;
  disconnect?: () => Promise<void>;
  info?: typeof logInfo;
  error?: typeof logError;
  setExitCode?: (code: number) => void;
  argv?: string[];
  env?: BackfillEnvironment;
};

function parseBoundedInteger(
  value: string,
  label: string,
  min: number,
  max: number,
): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function buildDocumentContentBackfillCliConfig(
  argv: string[],
  env: BackfillEnvironment = process.env,
): Required<ContentProjectionBackfillOptions> {
  const config: Required<ContentProjectionBackfillOptions> = {
    dryRun: true,
    batchSize: CONTENT_PROJECTION_BACKFILL_DEFAULT_BATCH_SIZE,
    maxRetries: CONTENT_PROJECTION_BACKFILL_DEFAULT_RETRIES,
    sampleLimit: CONTENT_PROJECTION_BACKFILL_DEFAULT_SAMPLE_LIMIT,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      config.dryRun = true;
    } else if (arg === "--execute") {
      config.dryRun = false;
    } else if (arg.startsWith("--batch-size=")) {
      config.batchSize = parseBoundedInteger(
        arg.slice("--batch-size=".length),
        "--batch-size",
        1,
        CONTENT_PROJECTION_BACKFILL_MAX_BATCH_SIZE,
      );
    } else if (arg.startsWith("--max-retries=")) {
      config.maxRetries = parseBoundedInteger(
        arg.slice("--max-retries=".length),
        "--max-retries",
        0,
        CONTENT_PROJECTION_BACKFILL_MAX_RETRIES,
      );
    } else if (arg.startsWith("--sample-limit=")) {
      config.sampleLimit = parseBoundedInteger(
        arg.slice("--sample-limit=".length),
        "--sample-limit",
        0,
        CONTENT_PROJECTION_BACKFILL_MAX_SAMPLE_LIMIT,
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    !config.dryRun &&
    env.DOCUMENT_CONTENT_BACKFILL_CONFIRM !== EXECUTE_CONFIRM_VALUE
  ) {
    throw new Error(
      `Unsafe config: --execute requires DOCUMENT_CONTENT_BACKFILL_CONFIRM=${EXECUTE_CONFIRM_VALUE}`,
    );
  }

  return config;
}

export async function runBackfillDocumentContentMain(
  deps: BackfillMainDeps = {},
): Promise<void> {
  const backfill = deps.backfill ?? backfillDocumentContentProjection;
  const disconnect = deps.disconnect ?? (() => prisma.$disconnect());
  const info = deps.info ?? logInfo;
  const error = deps.error ?? logError;
  const setExitCode = deps.setExitCode ?? ((code) => (process.exitCode = code));
  const argv = deps.argv ?? process.argv.slice(2);
  const env = deps.env ?? process.env;

  try {
    const config = buildDocumentContentBackfillCliConfig(argv, env);
    const result = await backfill(prisma, config);
    info(
      "document.content-projection.backfill",
      config.dryRun ? "dry run complete" : "backfill complete",
      { config, result },
    );
  } catch (cause) {
    error("document.content-projection.backfill", cause);
    setExitCode(1);
  }

  try {
    await disconnect();
  } catch (cause) {
    error("document.content-projection.backfill.disconnect", cause);
    setExitCode(1);
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
