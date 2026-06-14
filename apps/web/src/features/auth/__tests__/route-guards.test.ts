// Feature: web-app, Task 7.4 — route-guard behavior (example/behavioral tests)
// Validates: Requirements 15.4

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect, type AnyRedirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ERROR_CODES } from '@queuenow/shared-constants';
import { UserRoleType } from '@queuenow/shared-types';

import { strings } from '@/i18n';
import {
  flushRestrictionToast,
  requireAuthenticated,
  requireRole,
  takeRestrictionToast,
} from '@/features/auth/route-guards';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/**
 * Route-guard behavior (Requirement 15.4). These guards run inside TanStack
 * Router `beforeLoad` and signal a navigation by THROWING a `redirect(...)`.
 *
 * Redirect detection: `redirect({ to })` returns a `Response` augmented with an
 * `options` bag, and `beforeLoad` throws it. We detect the thrown value with the
 * router's own `isRedirect` type-guard and read the target from `options.to` —
 * no brittle string matching, no router instance required.
 *
 * Toast assertions: an unauthorized role guard cannot toast mid-redirect, so it
 * stashes a one-time message in a module-level queue and the layout drains it via
 * `flushRestrictionToast`. We mock `sonner`'s `toast` and assert `toast.error`
 * fires exactly once on flush (and the queue then clears).
 */

// Mock sonner at the boundary so flushing a restriction toast is observable.
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

const toastError = vi.mocked(toast.error);

/** Expected restriction copy = the guards' default (centralized catalog). */
const RESTRICTION_MESSAGE = strings.errors[ERROR_CODES.AUTH_FORBIDDEN];

/**
 * Invoke a guard and return the redirect it threw. Fails loudly if the guard
 * either does not throw or throws something that is not a router redirect.
 */
function captureRedirect(guard: () => void): AnyRedirect {
  try {
    guard();
  } catch (thrown) {
    if (isRedirect(thrown)) {
      return thrown;
    }
    throw thrown;
  }
  throw new Error('Expected the guard to throw a redirect, but nothing was thrown.');
}

/** Put the store into an authenticated session with the given role. */
function authenticateAs(role: UserRoleType): void {
  useAuthStore.setState({
    organization: { id: 'o1', name: 'Acme', slug: 'acme', role },
    status: 'authenticated',
  });
}

beforeEach(() => {
  useAuthStore.getState().clear();
  // Drain any message left over from a prior test so the queue starts empty.
  takeRestrictionToast();
  toastError.mockClear();
});

afterEach(() => {
  takeRestrictionToast();
});

describe('requireAuthenticated (Requirement 15.4)', () => {
  it('throws a redirect to /login when status is "unauthenticated"', () => {
    useAuthStore.setState({ status: 'unauthenticated' });

    const redirect = captureRedirect(requireAuthenticated);

    expect(redirect.options.to).toBe('/login');
  });

  it('throws a redirect to /login when status is "unknown"', () => {
    useAuthStore.setState({ status: 'unknown' });

    const redirect = captureRedirect(requireAuthenticated);

    expect(redirect.options.to).toBe('/login');
  });

  it('does not throw when status is "authenticated"', () => {
    authenticateAs(UserRoleType.STAFF);

    expect(() => requireAuthenticated()).not.toThrow();
  });
});

describe('requireRole (Requirement 15.4)', () => {
  it('redirects an unauthorized role to /dashboard and queues a restriction toast', () => {
    authenticateAs(UserRoleType.STAFF);

    const redirect = captureRedirect(() => requireRole([UserRoleType.OWNER, UserRoleType.ADMIN]));

    expect(redirect.options.to).toBe('/dashboard');

    // A message was queued — draining it via flush fires the mocked toast.
    flushRestrictionToast();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(RESTRICTION_MESSAGE);
  });

  it('uses a custom restriction message when provided', () => {
    authenticateAs(UserRoleType.STAFF);
    const custom = 'Owners and admins only.';

    captureRedirect(() => requireRole([UserRoleType.OWNER, UserRoleType.ADMIN], custom));

    flushRestrictionToast();
    expect(toastError).toHaveBeenCalledWith(custom);
  });

  it.each([UserRoleType.OWNER, UserRoleType.ADMIN])(
    'does not throw and queues no toast for authorized role %s',
    (role) => {
      authenticateAs(role);

      expect(() => requireRole([UserRoleType.OWNER, UserRoleType.ADMIN])).not.toThrow();

      // Nothing should have been queued, so a flush is a no-op.
      flushRestrictionToast();
      expect(toastError).not.toHaveBeenCalled();
    },
  );
});

describe('flushRestrictionToast (Requirement 15.4)', () => {
  it('fires toast.error exactly once for a queued restriction, then clears the queue', () => {
    authenticateAs(UserRoleType.STAFF);
    captureRedirect(() => requireRole([UserRoleType.OWNER]));

    flushRestrictionToast();
    expect(toastError).toHaveBeenCalledTimes(1);

    // The queue is one-shot: a second flush does nothing.
    flushRestrictionToast();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no restriction is queued', () => {
    flushRestrictionToast();
    expect(toastError).not.toHaveBeenCalled();
  });
});
