/**
 * RegisterForm — owner + organization sign-up (Requirements 4.2, 4.9, 4.10).
 *
 * Same pattern as {@link LoginForm}: validation uses the shared `registerSchema`
 * (types inferred from it) via TanStack Form's Standard Schema validator, submit
 * is disabled while pending, the returned session is stored by `useRegister`,
 * and we navigate to `/dashboard` on success. Backend `error.details` are mapped
 * onto fields (returned from `onSubmitAsync`); non-field errors become a toast.
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
	registerSchema,
	type RegisterInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage } from "@/lib/forms";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { toFieldErrors } from "../lib/field-errors";
import { useRegister } from "../hooks/useRegister";

/** Form fields eligible for backend inline error mapping. */
const REGISTER_FIELDS: readonly (keyof RegisterInput)[] = [
	"email",
	"password",
	"fullName",
	"phone",
	"organizationName",
	"organizationType",
];

/** Organization type options, ordered for display; labels from the i18n catalog. */
const ORG_TYPE_OPTIONS: readonly RegisterInput["organizationType"][] = [
	"CLINIC",
	"BANK",
	"RESTAURANT",
	"GOVERNMENT",
	"OTHER",
];

export function RegisterForm(): ReactElement {
	const navigate = useNavigate();
	const registerMutation = useRegister();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			fullName: "",
			phone: "",
			organizationName: "",
			organizationType: "CLINIC",
		} as RegisterInput,
		validators: {
			onSubmit: registerSchema,
			onSubmitAsync: async ({ value }) => {
				try {
					await registerMutation.mutateAsync(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						REGISTER_FIELDS as readonly string[],
					);
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
			toast.success(strings.auth.registerSuccess);
			void navigate({ to: "/dashboard" });
		},
	});

	return (
		<div className="w-full max-w-sm space-y-6">
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					{strings.auth.registerTitle}
				</h1>
				<p className="text-sm text-muted-foreground">
					{strings.auth.registerSubtitle}
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
				<form.Field name="fullName">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{strings.auth.fields.fullName}
								</Label>
								<Input
									id={field.name}
									name={field.name}
									autoComplete="name"
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
									autoComplete="new-password"
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

				<form.Field name="phone">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{strings.auth.fields.phone}</Label>
								<Input
									id={field.name}
									name={field.name}
									type="tel"
									autoComplete="tel"
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
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

				<form.Field name="organizationName">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{strings.auth.fields.organizationName}
								</Label>
								<Input
									id={field.name}
									name={field.name}
									autoComplete="organization"
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

				<form.Field name="organizationType">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{strings.auth.fields.organizationType}
								</Label>
								<select
									id={field.name}
									name={field.name}
									aria-invalid={error !== undefined}
									className={cn(
										"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
									)}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(
											event.target.value as RegisterInput["organizationType"],
										)
									}
								>
									{ORG_TYPE_OPTIONS.map((value) => (
										<option key={value} value={value}>
											{strings.auth.organizationTypes[value]}
										</option>
									))}
								</select>
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
								? strings.auth.registerPending
								: strings.auth.registerSubmit}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<p className="text-center text-sm text-muted-foreground">
				{strings.auth.hasAccountPrompt}{" "}
				<Link
					to="/login"
					className="font-medium text-primary underline-offset-4 hover:underline"
				>
					{strings.auth.loginLink}
				</Link>
			</p>
		</div>
	);
}
