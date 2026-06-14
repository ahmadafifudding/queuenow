/**
 * RegisterForm — owner + organization sign-up (Requirements 4.2, 4.9, 4.10).
 *
 * Same pattern as {@link LoginForm}: validation uses the shared `registerSchema`
 * (types inferred from it), submit is disabled while pending, the returned
 * session is stored by `useRegister`, and we navigate to `/dashboard` on success.
 * Backend `error.details` are mapped onto fields; non-field errors become a toast.
 */
import type { ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { Path } from "react-hook-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
	registerSchema,
	type RegisterInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { applyFieldErrors } from "../lib/field-errors";
import { useRegister } from "../hooks/useRegister";

/** Form fields eligible for backend inline error mapping. */
const REGISTER_FIELDS: readonly Path<RegisterInput>[] = [
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
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<RegisterInput>({
		resolver: zodResolver(registerSchema),
		defaultValues: {
			email: "",
			password: "",
			fullName: "",
			phone: "",
			organizationName: "",
			organizationType: "CLINIC",
		},
	});

	const onSubmit = handleSubmit((values) => {
		registerMutation.mutate(values, {
			onSuccess: () => {
				toast.success(strings.auth.registerSuccess);
				void navigate({ to: "/dashboard" });
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<RegisterInput>(
					error.details,
					REGISTER_FIELDS,
					setError,
				);
				if (mapped.length === 0) {
					toast.error(getErrorMessage(error));
				}
			},
		});
	});

	const isPending = registerMutation.isPending;

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

			<form noValidate onSubmit={onSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="register-fullName">
						{strings.auth.fields.fullName}
					</Label>
					<Input
						id="register-fullName"
						autoComplete="name"
						aria-invalid={errors.fullName !== undefined}
						aria-describedby={
							errors.fullName ? "register-fullName-error" : undefined
						}
						{...register("fullName")}
					/>
					{errors.fullName ? (
						<p
							id="register-fullName-error"
							className="text-sm text-destructive"
						>
							{errors.fullName.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="register-email">{strings.auth.fields.email}</Label>
					<Input
						id="register-email"
						type="email"
						autoComplete="email"
						aria-invalid={errors.email !== undefined}
						aria-describedby={errors.email ? "register-email-error" : undefined}
						{...register("email")}
					/>
					{errors.email ? (
						<p id="register-email-error" className="text-sm text-destructive">
							{errors.email.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="register-password">
						{strings.auth.fields.password}
					</Label>
					<Input
						id="register-password"
						type="password"
						autoComplete="new-password"
						aria-invalid={errors.password !== undefined}
						aria-describedby={
							errors.password ? "register-password-error" : undefined
						}
						{...register("password")}
					/>
					{errors.password ? (
						<p
							id="register-password-error"
							className="text-sm text-destructive"
						>
							{errors.password.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="register-phone">{strings.auth.fields.phone}</Label>
					<Input
						id="register-phone"
						type="tel"
						autoComplete="tel"
						aria-invalid={errors.phone !== undefined}
						aria-describedby={errors.phone ? "register-phone-error" : undefined}
						{...register("phone")}
					/>
					{errors.phone ? (
						<p id="register-phone-error" className="text-sm text-destructive">
							{errors.phone.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="register-organizationName">
						{strings.auth.fields.organizationName}
					</Label>
					<Input
						id="register-organizationName"
						autoComplete="organization"
						aria-invalid={errors.organizationName !== undefined}
						aria-describedby={
							errors.organizationName
								? "register-organizationName-error"
								: undefined
						}
						{...register("organizationName")}
					/>
					{errors.organizationName ? (
						<p
							id="register-organizationName-error"
							className="text-sm text-destructive"
						>
							{errors.organizationName.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="register-organizationType">
						{strings.auth.fields.organizationType}
					</Label>
					<select
						id="register-organizationType"
						aria-invalid={errors.organizationType !== undefined}
						aria-describedby={
							errors.organizationType
								? "register-organizationType-error"
								: undefined
						}
						className={cn(
							"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
						)}
						{...register("organizationType")}
					>
						{ORG_TYPE_OPTIONS.map((value) => (
							<option key={value} value={value}>
								{strings.auth.organizationTypes[value]}
							</option>
						))}
					</select>
					{errors.organizationType ? (
						<p
							id="register-organizationType-error"
							className="text-sm text-destructive"
						>
							{errors.organizationType.message}
						</p>
					) : null}
				</div>

				<Button type="submit" className="w-full" disabled={isPending}>
					{isPending
						? strings.auth.registerPending
						: strings.auth.registerSubmit}
				</Button>
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
