import type { Credentials } from "./auth";
import {
  E2E_PROFILE_FIXTURE,
  fixtureAssetChecksum,
  fixturePngBuffer,
} from "@/test/builders/e2e-profile";

export { E2E_PROFILE_FIXTURE, fixturePngBuffer };

/**
 * Deterministic E2E profile fixture (Epic #517, issue #518).
 *
 * The "E2E profile" is a fully deterministic seed (see `prisma/seed-e2e.ts`,
 * run via `npm run db:seed:e2e`) that creates a fixed owner user, a fixed
 * viewer user, and a single document carrying text, an embedded visual, a
 * persisted `deckJson`, an enabled public share policy, and one slide image
 * `Asset` (with storage bytes written). Every identifier below is a hard-coded
 * constant so the seed and the specs share one source of truth and never drift.
 *
 * Specs that exercise authenticated/seeded flows gate on {@link
 * e2eProfileEnabled}: when the profile is NOT enabled they skip cleanly, so the
 * credential-less fast gate and CI stay green. When `E2E_PROFILE=1` is set
 * (the `npm run test:e2e:profile` script does this against the seeded database)
 * those specs run for real and do NOT skip.
 *
 * Base values may be overridden from the environment (e.g. to point at a
 * staging seed), but the defaults are the deterministic local fixture.
 */

/** Owner login credentials for the deterministic profile. */
export function profileOwnerCredentials(): Credentials {
  return {
    email: E2E_PROFILE_FIXTURE.owner.email,
    password: E2E_PROFILE_FIXTURE.owner.password,
  };
}

/** Viewer (read-only) login credentials for the deterministic profile. */
export function profileViewerCredentials(): Credentials {
  return {
    email: E2E_PROFILE_FIXTURE.viewer.email,
    password: E2E_PROFILE_FIXTURE.viewer.password,
  };
}

/** App editor URL for the seeded document. */
export function profileDocPath(): string {
  return `/app/documents/${E2E_PROFILE_FIXTURE.documentId}`;
}

/** App editor URL for the seeded presentation layout screenshot document. */
export function profileLayoutDocPath(): string {
  return `/app/documents/${E2E_PROFILE_FIXTURE.layoutDocumentId}`;
}

/** Public `<slug>-<shareId>` URL segment for the seeded share links. */
export function profileShareSegment(): string {
  return `${E2E_PROFILE_FIXTURE.slug}-${E2E_PROFILE_FIXTURE.shareId}`;
}

/** Public present-mode path for the seeded deck. */
export function profilePresentPath(): string {
  return `/present/${profileShareSegment()}`;
}

/** Public embeddable present-mode path for the seeded deck. */
export function profilePresentEmbedPath(): string {
  return `/present/${profileShareSegment()}/embed`;
}

/** Protected slide-asset URL for the seeded image asset (public/shared doc). */
export function profileAssetPath(): string {
  return `/api/slide-assets/${E2E_PROFILE_FIXTURE.documentId}/${fixtureAssetChecksum()}.png`;
}

/** Protected slide-asset URL for the seeded asset on the PRIVATE document. */
export function profilePrivateAssetPath(): string {
  return `/api/slide-assets/${E2E_PROFILE_FIXTURE.privateDocumentId}/${fixtureAssetChecksum()}.png`;
}

/**
 * Single guard for every profile-dependent spec. Returns true only when the
 * deterministic E2E profile has been seeded and selected via `E2E_PROFILE=1`.
 *
 * Specs MUST `test.skip(!e2eProfileEnabled(), …)` so they degrade cleanly when
 * the profile is absent (the default for the fast gate and credential-less CI).
 */
export function e2eProfileEnabled(): boolean {
  return process.env.E2E_PROFILE === "1";
}
