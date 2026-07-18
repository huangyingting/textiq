#!/usr/bin/env node

import { precompileE2EProfile } from "./e2e-global-setup.mjs";

async function main() {
  await precompileE2EProfile();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
