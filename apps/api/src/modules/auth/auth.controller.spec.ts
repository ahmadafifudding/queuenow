import 'reflect-metadata';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';

/**
 * Task 5.2 — route-guard-metadata spec for the two organization-switching
 * endpoints (mirrors `organization-change-plan.spec.ts`).
 *
 * Unlike the organization controller (which guards at the class level), the
 * auth controller keeps `register`/`login`/`refresh` public and opts the two
 * new routes in with a PER-ROUTE `@UseGuards(JwtAuthGuard)`. NestJS attaches
 * `@UseGuards` metadata to the handler method, so the guard list is read from
 * `AuthController.prototype.<handler>` rather than from the controller class.
 *
 * These assertions pin that binding so an unauthenticated request to either
 * endpoint is rejected by `JwtAuthGuard` with `AUTH_UNAUTHORIZED` before the
 * handler runs (R1.9, R2.11, R7.2). The guard's own behavior is covered by its
 * dedicated spec; here we only verify the routing metadata.
 *
 * _Requirements: 1.9, 2.11, 7.2_
 */
describe('AuthController organization endpoints auth bindings (R1.9, R2.11, R7.2)', () => {
  const GUARDS_METADATA_KEY = '__guards__';

  it('guards GET /auth/organizations with JwtAuthGuard (anonymous ⇒ AUTH_UNAUTHORIZED)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      AuthController.prototype.listOrganizations,
    ) as unknown[] | undefined;

    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
  });

  it('guards POST /auth/switch-organization with JwtAuthGuard (anonymous ⇒ AUTH_UNAUTHORIZED)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      AuthController.prototype.switchOrganization,
    ) as unknown[] | undefined;

    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
  });

  it('keeps the public endpoints unguarded so JwtAuthGuard is not applied to them', () => {
    // The guard is opt-in per route; register/login/refresh must NOT carry it
    // (they rely on @Public()), confirming the per-route guarding decision.
    for (const handler of [
      AuthController.prototype.register,
      AuthController.prototype.login,
      AuthController.prototype.refresh,
    ]) {
      const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, handler) as unknown[] | undefined;

      expect(guards ?? []).not.toContain(JwtAuthGuard);
    }
  });
});
