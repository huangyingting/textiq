#!/usr/bin/env node

import {
  formatPrismaBoundaryFindings,
  runPrismaBoundaryCheck,
} from "./prisma-boundary.mjs";

const report = runPrismaBoundaryCheck(process.cwd());

if (report.violations.length > 0) {
  console.error(formatPrismaBoundaryFindings(report));
  process.exit(1);
}

console.log(
  "Prisma boundary check passed (restricted Document surface and owned raw adapters).",
);
