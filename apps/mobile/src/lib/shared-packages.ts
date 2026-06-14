/**
 * Boot presence-assertion for the three shared workspace packages (R14.3–R14.5).
 *
 * The app depends on ALL of `@queuenow/shared-types`, `@queuenow/shared-validation`,
 * and `@queuenow/shared-constants`. This module imports a concrete runtime sentinel
 * (and a type) from each package and asserts they resolved. Importing it from the
 * app entry puts every shared package in the Metro/TypeScript build graph, so a
 * missing or unresolved package fails the build loudly rather than letting the app
 * silently degrade to a subset of features.
 */

// @queuenow/shared-types — runtime enum sentinel + a type-only sentinel.
import { TicketStatus, type IOrganization } from '@queuenow/shared-types';
// @queuenow/shared-validation — runtime Zod schema sentinel.
import { joinQueueSchema } from '@queuenow/shared-validation';
// @queuenow/shared-constants — runtime constant sentinels.
import { ERROR_CODES, WS_EVENTS } from '@queuenow/shared-constants';

// Type-level sentinel: forces a compile error if the type export disappears.
type OrganizationSentinel = IOrganization;

/**
 * Runtime members re-exported as sentinels so a missing package surfaces at
 * import time (the bundler cannot resolve the module) rather than later.
 */
const sharedPackageSentinels = {
  ticketStatus: TicketStatus,
  joinQueueSchema,
  errorCodes: ERROR_CODES,
  wsEvents: WS_EVENTS,
} as const;

/**
 * Asserts every shared package resolved with a usable runtime sentinel.
 * Throws at boot if any package failed to load, so the failure is explicit.
 */
export function assertSharedPackagesPresent(): true {
  const missing: string[] = [];

  if (typeof TicketStatus?.WAITING !== 'string') {
    missing.push('@queuenow/shared-types');
  }
  if (typeof joinQueueSchema?.safeParse !== 'function') {
    missing.push('@queuenow/shared-validation');
  }
  if (typeof ERROR_CODES?.INTERNAL_ERROR !== 'string' || typeof WS_EVENTS?.SUBSCRIBE !== 'string') {
    missing.push('@queuenow/shared-constants');
  }

  if (missing.length > 0) {
    throw new Error(
      `[shared-packages] Missing or unresolved shared workspace package(s): ${missing.join(', ')}. ` +
        'All three @queuenow/shared-* packages are required at build time.',
    );
  }

  return true;
}

export { sharedPackageSentinels };
export type { OrganizationSentinel };
