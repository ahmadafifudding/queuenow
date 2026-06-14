/**
 * Auth_Store — in-memory session mirror (Zustand).
 *
 * This store holds ONLY the ephemeral, in-memory view of the customer session:
 * the customer profile and a coarse sign-in status used to gate account UI.
 *
 * It deliberately does NOT hold the access/refresh tokens. Long-term token
 * storage lives exclusively in the OS keychain/keystore via `secure-store.ts`
 * (R6.7) — mirroring `apps/web`, which keeps the access token in a non-persisted
 * Zustand store. Accordingly this store uses plain `create(...)` with NO
 * persistence middleware, so nothing here is serialized to device storage.
 *
 * Boot status is `'unknown'` until the Auth_Manager (task 4.2) resolves it to
 * `'signed-in'` or `'signed-out'`.
 */
import { create } from 'zustand';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';

/** The customer profile as returned by register/login. */
export type CustomerProfile = ICustomerLoginResponse['customer'];

/** Lifecycle of the session as known to the client. */
export type SessionStatus = 'unknown' | 'signed-in' | 'signed-out';

/** Shape of the in-memory session store. */
export interface AuthState {
  /** The signed-in customer profile, or `null` when not signed in. */
  customer: CustomerProfile | null;
  /** Current session lifecycle status. */
  status: SessionStatus;
  /**
   * Record the signed-in customer profile and flip status to `'signed-in'`.
   * Called by the Auth_Manager only AFTER tokens are write-confirmed (R6.8/R6.9).
   */
  setSession: (customer: CustomerProfile) => void;
  /** Clear the in-memory mirror (sign-out / failed session) → `'signed-out'`. */
  clear: () => void;
}

/**
 * In-memory session store. Created with plain `create` (no `persist`) so no
 * session data — and crucially no token — is ever written to device storage.
 */
export const useAuthStore = create<AuthState>((set) => ({
  customer: null,
  status: 'unknown',

  setSession: (customer) => set({ customer, status: 'signed-in' }),

  clear: () => set({ customer: null, status: 'signed-out' }),
}));

/**
 * Non-hook accessor for the store, for use outside React (e.g. the Auth_Manager
 * and REST client). Mirrors Zustand's vanilla API surface.
 */
export const authStore = {
  getState: useAuthStore.getState,
  setState: useAuthStore.setState,
  subscribe: useAuthStore.subscribe,
};
