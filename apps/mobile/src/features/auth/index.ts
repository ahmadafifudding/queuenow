/**
 * Auth feature barrel (R6).
 *
 * Exposes the screen components delegated to from the thin `app/(account)/*`
 * routes, the sign-out action used in the account stack header, the mutation
 * hooks (`useLogin`/`useRegister`/`useSignOut`), and the pure field-error
 * mapping helpers.
 */
export { SignInForm } from './components/SignInForm';
export { RegisterForm } from './components/RegisterForm';
export { SignOutButton } from './components/SignOutButton';
export { FormField, type FormFieldProps } from './components/FormField';
export { SubmitButton, type SubmitButtonProps } from './components/SubmitButton';
export { useLogin } from './hooks/use-login';
export { useRegister } from './hooks/use-register';
export { useSignOut } from './hooks/use-sign-out';
export {
  firstFieldMessages,
  mapBackendFieldErrors,
  type BackendFieldErrors,
} from './lib/field-errors';
