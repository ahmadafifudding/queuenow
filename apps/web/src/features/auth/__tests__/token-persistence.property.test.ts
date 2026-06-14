// Feature: web-app, Property 4: Access token is never written to web storage
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ILoginResponse } from '@queuenow/shared-types';
import { UserRoleType } from '@queuenow/shared-types';
import { useAuthStore } from '../stores/auth-store';

/**
 * Property 4 — Validates: Requirements 4.4
 *
 * The access token lives ONLY in the in-memory Auth_Store. No auth action
 * (`setSession`, `setAccessToken`, `clear`) — in any order — may cause the
 * token to be written to `localStorage`, `sessionStorage`, or `document.cookie`.
 *
 * Strategy: generate an arbitrary access-token string plus an arbitrary
 * SEQUENCE of auth commands, apply them to the store one at a time, and after
 * EACH step scan all three web-storage surfaces and assert the token value
 * appears in none of them. The token may only be readable from
 * `useAuthStore.getState().accessToken`.
 */

/** The auth commands exercised by the sequence generator. */
enum AuthCommand {
  SetSession = 'setSession',
  SetAccessToken = 'setAccessToken',
  Clear = 'clear',
}

/**
 * Build a valid `ILoginResponse` whose `tokens.accessToken` is the generated
 * token, so `setSession` stores exactly that token. The remaining fields are
 * fixed, well-formed values — they are irrelevant to the storage invariant.
 */
function buildLoginResponse(token: string): ILoginResponse {
  return {
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      fullName: 'Test Owner',
      avatarUrl: null,
    },
    organization: {
      id: 'org-1',
      name: 'Test Org',
      slug: 'test-org',
      role: UserRoleType.OWNER,
    },
    tokens: {
      accessToken: token,
      refreshToken: 'refresh-token-value',
    },
  };
}

/** Wipe every cookie currently visible to `document.cookie`. */
function wipeCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

/**
 * Assert the token value appears in none of localStorage, sessionStorage, or
 * document.cookie. Scans every key AND value of both Storage objects, plus the
 * full cookie string.
 */
function expectTokenAbsentFromStorage(token: string): void {
  const storages: Storage[] = [localStorage, sessionStorage];
  for (const storage of storages) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      expect(key).not.toContain(token);
      if (key !== null) {
        expect(storage.getItem(key) ?? '').not.toContain(token);
      }
    }
  }
  expect(document.cookie).not.toContain(token);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  wipeCookies();
  useAuthStore.getState().clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  wipeCookies();
  useAuthStore.getState().clear();
});

describe('Property 4: access token is never written to web storage', () => {
  it('keeps the token out of localStorage, sessionStorage, and cookies across any action sequence', () => {
    fc.assert(
      fc.property(
        // Non-trivial token: a JWT-like string of three non-empty base64url-ish segments.
        fc
          .tuple(
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
          )
          .map(([h, p, s]) => `${h}.${p}.${s}`),
        fc.array(fc.constantFrom(...Object.values(AuthCommand)), { minLength: 1, maxLength: 12 }),
        (token, commands) => {
          const response = buildLoginResponse(token);

          for (const command of commands) {
            switch (command) {
              case AuthCommand.SetSession:
                useAuthStore.getState().setSession(response);
                break;
              case AuthCommand.SetAccessToken:
                useAuthStore.getState().setAccessToken(token);
                break;
              case AuthCommand.Clear:
                useAuthStore.getState().clear();
                break;
            }

            // The token must never leak to any web-storage surface...
            expectTokenAbsentFromStorage(token);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exposes the token only from the in-memory store after it is set', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s) => `${s}.payload.sig`),
        (token) => {
          useAuthStore.getState().setAccessToken(token);

          // ...while remaining readable from the in-memory store.
          expect(useAuthStore.getState().accessToken).toBe(token);
          expectTokenAbsentFromStorage(token);
        },
      ),
      { numRuns: 200 },
    );
  });
});
