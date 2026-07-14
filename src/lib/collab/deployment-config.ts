/**
 * Pure deployment configuration decision module for the TextIQ collaboration
 * server.
 *
 * Given a subset of environment variables, produces an explicit mode declaration,
 * human-readable warnings, and a `healthy` flag. The logic is free of I/O and
 * side-effects so it can be exercised directly by node:test.
 *
 * Runtime parity is enforced by sharing the canonical implementation in
 * `deployment-config-source.mjs`, which is consumed by both this TypeScript
 * module and the plain-ESM server adapter.
 */
import { resolveDeploymentConfig as resolveDeploymentConfigSource } from "./deployment-config-source.mjs";

type CollabDeploymentMode = "single-instance" | "unconfigured";

export interface CollabDeploymentConfig {
  /** Explicitly declared mode, or 'unconfigured' if no declaration was made. */
  mode: CollabDeploymentMode;
  /** Human-readable warnings about the current configuration. */
  warnings: string[];
  /**
   * False when the configuration is actively harmful — e.g. multiple instances
   * detected without sticky routing, which causes silent edit divergence.
   */
  healthy: boolean;
}

/** The subset of process.env consumed by the config module. */
export interface CollabEnv {
  COLLAB_SINGLE_INSTANCE?: string;
  COLLAB_INSTANCE_COUNT?: string;
  COLLAB_STICKY_ROUTING?: string;
}

/**
 * Derives the collaboration deployment configuration from environment variables.
 * Pure: no I/O, no side-effects, fully testable.
 *
 * Decision matrix:
 * - `COLLAB_SINGLE_INSTANCE=1|true`                     → single-instance, healthy, no warnings
 * - `COLLAB_INSTANCE_COUNT>1` + no sticky routing       → unconfigured, unhealthy, divergence warning
 * - `COLLAB_INSTANCE_COUNT>1` + `COLLAB_STICKY_ROUTING=1|true` → unconfigured, healthy, no warnings
 * - Default (nothing set / COLLAB_INSTANCE_COUNT<=1)    → unconfigured, healthy, soft advisory
 */
export function resolveDeploymentConfig(
  env: CollabEnv = {},
): CollabDeploymentConfig {
  return resolveDeploymentConfigSource(
    env as Record<string, string | undefined>,
  );
}

/** Runtime statistics collected from the running server. */
export interface CollabRuntimeStats {
  rooms: number;
  connections: number;
}

/** Full health summary returned by the `/health` endpoint. */
export interface CollabHealthSummary {
  ok: boolean;
  rooms: number;
  connections: number;
  mode: CollabDeploymentMode;
  warnings: string[];
  healthy: boolean;
}

/**
 * Combines live runtime statistics with the deployment configuration into a
 * single health-summary object suitable for serialising as JSON in `/health`.
 */
export function buildHealthSummary(
  stats: CollabRuntimeStats,
  config: CollabDeploymentConfig,
): CollabHealthSummary {
  return {
    ok: config.healthy,
    rooms: stats.rooms,
    connections: stats.connections,
    mode: config.mode,
    warnings: config.warnings,
    healthy: config.healthy,
  };
}
