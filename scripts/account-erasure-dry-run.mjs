#!/usr/bin/env node

export function buildAccountErasureDryRunReport(userId, findings) {
  const residualCount = findings.reduce(
    (sum, finding) => sum + finding.count,
    0,
  );
  return {
    userId,
    ok: findings.length === 0,
    residualCount,
    findings: findings.map((finding) => ({
      model: finding.model,
      count: finding.count,
    })),
  };
}

export async function runAccountErasureDryRun({
  argv = process.argv,
  importDeps = async () =>
    Promise.all([
      import("../src/lib/prisma.ts"),
      import("../src/lib/account/erasure.ts"),
    ]),
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const userId = argv[2];
  if (!userId || userId === "--help" || userId === "-h") {
    stderr(
      "Usage: node --import tsx scripts/account-erasure-dry-run.mjs <userId>",
    );
    process.exitCode = userId ? 0 : 1;
    return;
  }

  const [{ prisma }, { verifyAccountErasure }] = await importDeps();
  try {
    const findings = await verifyAccountErasure(prisma, userId);
    stdout(JSON.stringify(buildAccountErasureDryRunReport(userId, findings)));
    process.exitCode = findings.length === 0 ? 0 : 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAccountErasureDryRun().catch((error) => {
    console.error(error instanceof Error ? error.message : "dry-run failed");
    process.exitCode = 1;
  });
}
