import { logScriptError, logScriptInfo } from "./structured-log.mjs";

const DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS = 5_000;
const SIGNALS = ["SIGINT", "SIGTERM"];

function closeHttpServer(server, timeoutMs) {
  if (!server?.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    timeout = setTimeout(() => {
      try {
        server.closeAllConnections?.();
      } catch (err) {
        finish(err);
        return;
      }
      finish();
    }, timeoutMs);

    try {
      server.close((err) => {
        finish(err);
      });
    } catch (err) {
      finish(err);
    }
  });
}

/**
 * Installs one idempotent graceful-shutdown path for the inline and standalone
 * collaboration entry points. Collaboration drains first so the inline
 * flusher can still POST to the app's internal endpoint before HTTP closes.
 *
 * @param {Object} options
 * @param {import("node:http").Server} options.server
 * @param {() => Promise<void>} options.closeCollaboration
 * @param {() => Promise<void>} [options.closeApplication]
 * @param {'inline'|'standalone'} options.runtimeMode
 * @param {NodeJS.Process} [options.processTarget]
 * @param {number} [options.httpShutdownTimeoutMs]
 */
export function installCollabServerShutdown(options) {
  const processTarget = options.processTarget ?? process;
  const httpShutdownTimeoutMs =
    Number.isSafeInteger(options.httpShutdownTimeoutMs) &&
    options.httpShutdownTimeoutMs > 0
      ? options.httpShutdownTimeoutMs
      : DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS;
  let shutdownPromise = null;

  const shutdown = (signal = "manual") => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logScriptInfo("collab.server.shutdown", "graceful shutdown started", {
        runtimeMode: options.runtimeMode,
        signal,
      });

      let failed = false;
      for (const [phase, close] of [
        ["collaboration", options.closeCollaboration],
        ["http", () => closeHttpServer(options.server, httpShutdownTimeoutMs)],
        ["application", options.closeApplication],
      ]) {
        if (typeof close !== "function") continue;
        try {
          await close();
        } catch (err) {
          failed = true;
          logScriptError("collab.server.shutdown", err, { phase });
        }
      }

      if (failed) {
        processTarget.exitCode = 1;
      }
      logScriptInfo("collab.server.shutdown", "graceful shutdown finished", {
        runtimeMode: options.runtimeMode,
        signal,
        ok: !failed,
      });
      return { ok: !failed };
    })();

    return shutdownPromise;
  };

  const handlers = new Map(
    SIGNALS.map((signal) => [signal, () => void shutdown(signal)]),
  );
  for (const [signal, handler] of handlers) {
    processTarget.on(signal, handler);
  }

  return {
    shutdown,
    dispose() {
      for (const [signal, handler] of handlers) {
        processTarget.off(signal, handler);
      }
    },
  };
}
