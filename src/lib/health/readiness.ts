const READINESS_TIMEOUT_MS = 2_000;
const READY_CACHE_TTL_MS = 5_000;
const NOT_READY_CACHE_TTL_MS = 1_000;

export type ApplicationReadinessProbe = () => Promise<boolean>;

type ReadinessDependencies = {
  checkDatabase: () => Promise<unknown>;
  isConfigurationReady: () => boolean;
};

/**
 * Builds a bounded, single-flight application readiness probe.
 *
 * Required configuration is evaluated on every call so an invalid runtime can
 * never reuse a cached database success. Database checks are shared while in
 * flight and their result is cached briefly to prevent public health probes
 * from amplifying load. A timed-out check remains the sole in-flight check;
 * later callers do not start additional database work while it is unresolved.
 */
export function createApplicationReadinessProbe(
  dependencies: ReadinessDependencies,
): ApplicationReadinessProbe {
  let cached: { ready: boolean; expiresAt: number } | null = null;
  let inFlight: Promise<boolean> | null = null;

  function configurationReady(): boolean {
    try {
      return dependencies.isConfigurationReady();
    } catch {
      return false;
    }
  }

  function startDatabaseCheck(): Promise<boolean> {
    const execution = Promise.resolve()
      .then(() => dependencies.checkDatabase())
      .then(
        () => true,
        () => false,
      );
    inFlight = execution;

    void execution
      .then((ready) => {
        cached = {
          ready,
          expiresAt:
            Date.now() + (ready ? READY_CACHE_TTL_MS : NOT_READY_CACHE_TTL_MS),
        };
      })
      .finally(() => {
        if (inFlight === execution) {
          inFlight = null;
        }
      });

    return execution;
  }

  return async function probeApplicationReadiness(): Promise<boolean> {
    if (!configurationReady()) return false;

    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.ready;
    }

    const databaseCheck = inFlight ?? startDatabaseCheck();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        databaseCheck,
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
}
