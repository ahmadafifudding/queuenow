/**
 * Device fingerprint (R2.3) — a stable, anonymous device identifier.
 *
 * The fingerprint is generated exactly once on first launch (a random UUID v4)
 * and persisted in the OS keychain/keystore via `secure-store.ts`. Every
 * subsequent call returns the same value, so anonymous tickets can be
 * re-associated with the device and ownership-scoped leave/cancel works (R11)
 * without requiring an account.
 *
 * Persistence uses write-with-confirmation (R6.8/R6.9): the freshly generated id
 * is only treated as "the" fingerprint after it is read back successfully. If
 * secure storage is unavailable, the generated id is still returned for the
 * current session (so a join can proceed) but is not cached as durable — the
 * next launch will try to persist again.
 *
 * Testability: the secure store and the UUID generator are both injectable, so
 * tests can drive first-launch generation, the persisted-read path, and the
 * storage-failure path deterministically without a device keychain.
 */
import * as Crypto from 'expo-crypto';
import {
  SECURE_STORE_KEYS,
  secureStore as defaultSecureStore,
  type SecureStoreApi,
} from './secure-store';

/** Generates a new random identifier. Injectable for deterministic tests. */
export type IdGenerator = () => string;

/** Default id generator: a random UUID v4 from `expo-crypto`. */
export const defaultIdGenerator: IdGenerator = () => Crypto.randomUUID();

/** Dependencies for {@link getDeviceFingerprint}; all injectable for testing. */
export interface FingerprintDeps {
  /** Secure storage used to read/persist the fingerprint. */
  store: SecureStoreApi;
  /** Source of new fingerprint values on first launch. */
  generateId: IdGenerator;
}

/** The default production dependencies (real secure store + UUID generator). */
const defaultDeps: FingerprintDeps = {
  store: defaultSecureStore,
  generateId: defaultIdGenerator,
};

/**
 * Process-level cache so repeated calls within a session avoid re-reading the
 * keychain and always yield the same value even if a persist attempt failed.
 */
let cachedFingerprint: string | null = null;

/**
 * Return the stable device fingerprint, generating and persisting one on first
 * launch (R2.3).
 *
 * Resolution order:
 * 1. In-memory cache (same value for the rest of the session).
 * 2. The value already persisted in secure storage.
 * 3. A freshly generated UUID, persisted with write-confirmation.
 *
 * @param deps Optional injected dependencies (secure store + id generator).
 */
export async function getDeviceFingerprint(deps: FingerprintDeps = defaultDeps): Promise<string> {
  if (cachedFingerprint !== null) {
    return cachedFingerprint;
  }

  // Prefer an already-persisted fingerprint.
  let existing: string | null = null;
  try {
    existing = await deps.store.read(SECURE_STORE_KEYS.deviceFingerprint);
  } catch {
    existing = null;
  }

  if (existing !== null && existing.length > 0) {
    cachedFingerprint = existing;
    return existing;
  }

  // First launch (or unreadable): generate and try to persist with confirmation.
  const generated = deps.generateId();
  const confirmed = await deps.store.writeConfirmed(SECURE_STORE_KEYS.deviceFingerprint, generated);

  // Cache only when durably persisted; otherwise return for this session and
  // retry persistence on the next launch (storage may have been unavailable).
  if (confirmed) {
    cachedFingerprint = generated;
  }

  return generated;
}

/**
 * Reset the in-memory cache. Intended for tests so each case starts from a clean
 * first-launch state; not used by application code.
 */
export function resetDeviceFingerprintCache(): void {
  cachedFingerprint = null;
}
