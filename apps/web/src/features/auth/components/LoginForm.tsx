/**
 * LoginForm — email/password sign-in (Requirements 4.1, 4.9, 4.10).
 *
 * - Validation uses the shared `loginSchema` from `@queuenow/shared-validation`
 *   via TanStack Form's Standard Schema validator (no client-side redefinition
 *   of the rules); the field types are inferred from the schema.
 * - Submit is disabled while the submission is in flight (R4.9).
 * - On success: the session is stored by `useLogin` (setSession), a success toast
 *   shows, and we navigate to `/dashboard`.
 * - On failure: backend `error.details` are mapped onto the matching fields as
 *   inline errors (returned from the form's `onSubmitAsync` validator); if the
 *   error is not field-specific, a general toast mapped from `error.code` is
 *   shown instead (R4.10).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { loginSchema, type LoginInput } from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage } from "@/lib/forms";
import { strings } from "@/i18n";

import { toFieldErrors } from "../lib/field-errors";
import { useLogin } from "../hooks/useLogin";

/** Form fields eligible for backend inline error mapping. */
const LOGIN_FIELDS: readonly (keyof LoginInput)[] = ["email", "password"];

export function LoginForm(): ReactElement {
	const navigate = useNavigate();
	const login = useLogin();

	const form = useForm({
		defaultValues: { email: "", password: "" } as LoginInput,
		validators: {
			onSubmit: loginSchema,
			onSubmitAsync: async ({ value }) => {
				try {
					await login.mutateAsync(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						LOGIN_FIELDS as readonly string[],
					);
					// Surface a general toast only when not field-specific.
					if (mapped.length === 0) {
						const message = getErrorMessage(apiError);
						toast.error(message);
						return { form: message };
					}
					return { fields };
				}
			},
		},
		onSubmit: () => {
			toast.success(strings.auth.loginSuccess);
			void navigate({ to: "/dashboard" });
		},
	});

	return (
		<div className="w-full max-w-sm space-y-6">
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					{strings.auth.loginTitle}
				</h1>
				<p className="text-sm text-muted-foreground">
					{strings.auth.loginSubtitle}
				</p>
			</div>

			<form
				noValidate
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="email">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{strings.auth.fields.email}</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									autoComplete="email"
									aria-invalid={error !== undefined}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : null}
							</div>
						);
					}}
				</form.Field>

				<form.Field name="password">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{strings.auth.fields.password}
								</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="current-password"
									aria-invalid={error !== undefined}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : null}
							</div>
						);
					}}
				</form.Field>

				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" className="w-full" disabled={isSubmitting}>
							{isSubmitting
								? strings.auth.loginPending
								: strings.auth.loginSubmit}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<p className="text-center text-sm text-muted-foreground">
				{strings.auth.noAccountPrompt}{" "}
				<Link
					to="/register"
					className="font-medium text-primary underline-offset-4 hover:underline"
				>
					{strings.auth.registerLink}
				</Link>
			</p>
		</div>
	);
}
