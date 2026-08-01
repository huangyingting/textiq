import { expect, test } from "@playwright/test";

import { unauthenticatedRequest } from "../helpers/credential-gate";
import { e2eProfileEnabled } from "../helpers/profile";

test.describe("collaboration runtime", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and launch the self-contained profile.",
  );

  test("profile declares single-instance mode and enables recovery flushes @required-profile", async () => {
    const response = await unauthenticatedRequest().get("/collab/health");

    expect(response.status()).toBe(200);
    const health = await response.json();
    expect(health).toMatchObject({
      ok: true,
      healthy: true,
      mode: "single-instance",
      warnings: [],
      recoveryFlushConfigured: true,
      flushFailures: 0,
      recentFlushFailureCount: 0,
    });
    expect(health.rooms).toEqual(expect.any(Number));
    expect(health.connections).toEqual(expect.any(Number));
    const internalSecret = process.env.COLLAB_INTERNAL_SECRET;
    if (!internalSecret) {
      throw new Error(
        "The self-contained profile must provision COLLAB_INTERNAL_SECRET.",
      );
    }
    expect(JSON.stringify(health)).not.toContain(internalSecret);
  });
});
