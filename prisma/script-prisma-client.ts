import { createIsolatedPrismaSurface } from "../src/lib/prisma-internal";

export function createScriptPrismaClient() {
  return createIsolatedPrismaSurface();
}
