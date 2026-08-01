import { createApplicationReadinessProbe } from "@/lib/health/readiness";
import { prisma } from "@/lib/prisma";

import { createReadinessHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createReadinessHandler(
  createApplicationReadinessProbe({
    checkDatabase: async () => {
      await prisma.user.findFirst({ select: { id: true } });
    },
    isConfigurationReady: () =>
      process.env.NODE_ENV !== "production" ||
      Boolean(process.env.AUTH_SECRET?.trim()),
  }),
);
