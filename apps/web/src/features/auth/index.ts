/**
 * Public surface of the auth feature for role-based UI (task 7.2).
 *
 * Consumers (e.g. the `_authenticated` layout route in task 7.1, and feature
 * modules gating their controls) should import from here rather than reaching
 * into internal files.
 */

// Capability matrix (single source of truth for role-based visibility).
export { CAPABILITY_MATRIX, roleHasCapability, roleIsOneOf, type Capability } from './capabilities';

// Role / capability hooks.
export { useActiveRole, useHasRole, useHasCapability } from './hooks/useHasRole';

// Conditional-rendering component.
export { RoleGate, type RoleGateProps } from './components/RoleGate';

// Gated authenticated app shell.
export {
  AppShell,
  DEFAULT_NAV_ITEMS,
  type AppShellNavItem,
  type AppShellProps,
} from './components/AppShell';

// Re-export the auth store for convenience (defined in task 6.1).
export { useAuthStore } from './stores/auth-store';

// Auth flow: forms, mutation hooks, and field-error mapping (task 6.3).
// `toFieldErrors` maps backend `error.details` onto a form's known fields for
// TanStack Form's `onSubmitAsync` validator.
export { LoginForm } from './components/LoginForm';
export { RegisterForm } from './components/RegisterForm';
export { useLogin } from './hooks/useLogin';
export { useRegister } from './hooks/useRegister';
export { useLogout, type UseLogoutResult } from './hooks/useLogout';
export { toFieldErrors, type FieldErrorsResult } from './lib/field-errors';
