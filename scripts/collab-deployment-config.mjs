/**
 * Plain-ESM adapter for the canonical deployment policy implementation.
 * Server scripts run as plain Node.js and consume this stable .mjs surface.
 */
export { resolveDeploymentConfig } from "../src/lib/collab/deployment-config-source.mjs";
