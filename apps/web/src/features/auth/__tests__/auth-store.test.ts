import { beforeEach, describe, expect, it } from 'vitest';
import { UserRoleType, type ILoginResponse } from '@queuenow/shared-types';
import { useAuthStore } from '../stores/auth-store';

function makeLoginResponse(): ILoginResponse {
  return {
    user: { id: 'u1', email: 'a@b.com', fullName: 'Ada Lovelace', avatarUrl: null },
    organization: { id: 'o1', name: 'Acme', slug: 'acme', role: UserRoleType.OWNER },
    tokens: { accessToken: 'access-123', refreshToken: 'refresh-456' },
  };
}

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    // Reset to the true boot state for the initial-status assertion.
    useAuthStore.setState({ status: 'unknown' });
  });

  it('boots with empty session and status "unknown"', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.organization).toBeNull();
    expect(state.status).toBe('unknown');
  });

  it('setSession stores token, user, and organization/role and marks authenticated', () => {
    const response = makeLoginResponse();
    useAuthStore.getState().setSession(response);

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-123');
    expect(state.user).toEqual(response.user);
    expect(state.organization).toEqual(response.organization);
    expect(state.organization?.role).toBe(UserRoleType.OWNER);
    expect(state.status).toBe('authenticated');
  });

  it('setSession ignores the body refresh token (only accessToken is read)', () => {
    useAuthStore.getState().setSession(makeLoginResponse());
    // The store has no field that could hold a refresh token.
    expect(JSON.stringify(useAuthStore.getState())).not.toContain('refresh-456');
  });

  it('setAccessToken replaces only the access token', () => {
    useAuthStore.getState().setSession(makeLoginResponse());
    useAuthStore.getState().setAccessToken('access-789');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-789');
    expect(state.user).not.toBeNull();
    expect(state.status).toBe('authenticated');
  });

  it('clear resets the session and sets status "unauthenticated"', () => {
    useAuthStore.getState().setSession(makeLoginResponse());
    useAuthStore.getState().clear();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.organization).toBeNull();
    expect(state.status).toBe('unauthenticated');
  });
});
