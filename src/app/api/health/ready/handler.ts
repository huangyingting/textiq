import { NextResponse } from "next/server";

import type { ApplicationReadinessProbe } from "@/lib/health/readiness";

export function createReadinessHandler(probe: ApplicationReadinessProbe) {
  return async function GET(): Promise<NextResponse> {
    const ready = await probe();
    return NextResponse.json(
      { status: ready ? "ready" : "not_ready" },
      {
        status: ready ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  };
}
