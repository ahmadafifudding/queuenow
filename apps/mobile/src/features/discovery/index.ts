/**
 * Discovery feature barrel (R1).
 *
 * Exposes the PURE building blocks (`parseDiscoveryUrl`, `buildJoinDeepLink`,
 * `manualDiscoveryTarget`, `resolveOrgIdentifier`, `joinAvailability`,
 * `normalizeServices`) used by the property tests (tasks 7.2, 7.3), the
 * service-resolution hooks (`useOrgStatus`, `useDiscovery`), and the screen
 * components delegated to from the thin `app/` routes.
 */
export {
  buildJoinDeepLink,
  manualDiscoveryTarget,
  parseDiscoveryUrl,
  resolveOrgIdentifier,
} from './parse-discovery-url';
export {
  DISCOVERY_BLOCKING_ERROR_CODES,
  joinAvailability,
  normalizeServices,
} from './join-availability';
export { useDiscovery, useOrgStatus, type UseDiscoveryResult } from './use-discovery';
export { DiscoveryHome } from './components/DiscoveryHome';
export { QrScanner } from './components/QrScanner';
export { ServiceSelection, type ServiceSelectionProps } from './components/ServiceSelection';
export type {
  DiscoveryServiceStatus,
  DiscoveryServiceSummary,
  DiscoverySource,
  DiscoveryTarget,
  JoinAvailabilityDecision,
  JoinAvailabilityInput,
  OrgQueueStatus,
} from './types';
