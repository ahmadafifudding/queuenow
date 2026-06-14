/**
 * LoginForm — email/password sign-in (Requirements 4.1, 4.9, 4.10).
 *
 * - Validation uses the shared `loginSchema` from `@queuenow/shared-validation`
 *   via react-hook-form + the Zod resolver; the field types are inferred from
 *   the schema (no client-side redefinition of the rules).
 * - Submit is disabled while the mutation is pending (R4.9).
 * - On success: the session is stored by `useLogin` (setSession), a success toast
 *   shows, and we navigate to `/dashboard`.
 * - On failure: backend `error.details` are mapped onto the matching fields as
 *   inline errors; if the error is not field-specific, a general toast mapped
 *   from `error.code` is shown instead (R4.10).
 */
import type { ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { Path } from "react-hook-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { loginSchema, type LoginInput } from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { applyFieldErrors } from "../lib/field-errors";
import { useLogin } from "../hooks/useLogin";

/** Form fields eligible for backend inline error mapping. */
const LOGIN_FIELDS: readonly Path<LoginInput>[] = ["email", "password"];

export function LoginForm(): ReactElement {
	const navigate = useNavigate();
	const login = useLogin();
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<LoginInput>({
		resolver: zodResolver(loginSchema),
		defaultValues: { email: "", password: "" },
	});

	const onSubmit = handleSubmit((values) => {
		login.mutate(values, {
			onSuccess: () => {
				toast.success(strings.auth.loginSuccess);
				void navigate({ to: "/dashboard" });
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<LoginInput>(
					error.details,
					LOGIN_FIELDS,
					setError,
				);
				// Only surface a general toast when the failure was not field-specific.
				if (mapped.length === 0) {
					toast.error(getErrorMessage(error));
				}
			},
		});
	});

	const isPending = login.isPending;

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

			<form noValidate onSubmit={onSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="login-email">{strings.auth.fields.email}</Label>
					<Input
						id="login-email"
						type="email"
						autoComplete="email"
						aria-invalid={errors.email !== undefined}
						aria-describedby={errors.email ? "login-email-error" : undefined}
						{...register("email")}
					/>
					{errors.email ? (
						<p id="login-email-error" className="text-sm text-destructive">
							{errors.email.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="login-password">{strings.auth.fields.password}</Label>
					<Input
						id="login-password"
						type="password"
						autoComplete="current-password"
						aria-invalid={errors.password !== undefined}
						aria-describedby={
							errors.password ? "login-password-error" : undefined
						}
						{...register("password")}
					/>
					{errors.password ? (
						<p id="login-password-error" className="text-sm text-destructive">
							{errors.password.message}
						</p>
					) : null}
				</div>

				<Button type="submit" className="w-full" disabled={isPending}>
					{isPending ? strings.auth.loginPending : strings.auth.loginSubmit}
				</Button>
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
