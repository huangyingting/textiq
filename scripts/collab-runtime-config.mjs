import { resolveDeploymentConfig } from "./collab-deployment-config.mjs";
import { logScriptError, logScriptWarning } from "./structured-log.mjs";

/**
 * @typedef {'inline'|'standalone'} CollabRuntimeMode
 */

/**
 * Resolves and validates deployment mode from environment variables.
 *
 * @param {Record<string, string|undefined>} env
 */
export function resolveCollabDeployment(env = {}) {
  return resolveDeploymentConfig(env);
}

/**
 * Emits deployment warnings/fatal diagnostics in the entry point's existing
 * shape. Returns `false` when the caller must fail closed and stop startup.
 *
 * @param {{ mode: string, warnings: string[], healthy: boolean }} deploymentConfig
 * @param {{
 *   runtimeMode: CollabRuntimeMode,
 *   scope?: string,
 *   writeInlineWarning?: (line: string) => void,
 *   writeInlineError?: (line: string) => void,
 * }} options
 * @returns {boolean}
 */
export function emitDeploymentDiagnostics(deploymentConfig, options) {
  const runtimeMode = options.runtimeMode;
  const scope = options.scope || "collab.server.configure";
  const writeInlineWarning = options.writeInlineWarning || (() => {});
  const writeInlineError = options.writeInlineError || (() => {});

  if (!deploymentConfig.healthy) {
    if (runtimeMode === "inline") {
      for (const warning of deploymentConfig.warnings) {
        writeInlineError(`[collab] FATAL CONFIG ERROR: ${warning}`);
      }
      writeInlineError(
        "[collab] Refusing to start in a misconfigured multi-instance environment. " +
          "Fix the configuration and restart.",
      );
    } else {
      for (const warning of deploymentConfig.warnings) {
        logScriptError(scope, new Error(warning), {
          mode: deploymentConfig.mode,
        });
      }
      logScriptError(
        scope,
        new Error("refusing to start in a misconfigured environment"),
        { mode: deploymentConfig.mode },
      );
    }
    return false;
  }

  for (const warning of deploymentConfig.warnings) {
    if (runtimeMode === "inline") {
      writeInlineWarning(`[collab] CONFIG WARNING: ${warning}`);
    } else {
      logScriptWarning(scope, "configuration warning", {
        mode: deploymentConfig.mode,
        warning,
      });
    }
  }

  return true;
}
