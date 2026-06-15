/**
 * OrganizationDetailsForm — edit org name/address/phone/email/timezone (R11.1).
 *
 * - Validation uses the shared `updateOrganizationSchema` via TanStack Form's
 *   Standard Schema validator; field types are inferred from the schema (no
 *   client-side redefinition of the rules).
 * - Optional fields are coerced from `''` → `undefined` at submit time so
 *   leaving them blank omits them rather than failing `.email()`.
 * - Submit is disabled while the mutation is in flight.
 * - On success: a success toast shows. On failure: backend `error.details` map
 *   onto the matching fields (returned from `onSubmitAsync`); a non-field error
 *   surfaces a code-mapped toast (R11.8).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
	updateOrganizationSchema,
	type UpdateOrganizationInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toFieldErrors } from "@/features/auth";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage } from "@/lib/forms";
import { strings } from "@/i18n";

import type { OrganizationDetails } from "../types";
import { emptyToUndefined } from "../lib/form-coerce";
import { useUpdateOrganization } from "../api/useUpdateOrganization";

/** Fields eligible for backend inline error mapping. */
const ORG_FIELDS: readonly (keyof UpdateOrganizationInput)[] = [
	"name",
	"address",
	"phone",
	"email",
	"timezone",
];

export interface OrganizationDetailsFormProps {
	/** The organization being edited. */
	organization: OrganizationDetails;
}

export function OrganizationDetailsForm({
	organization,
}: OrganizationDetailsFormProps): ReactElement {
	const copy = strings.organization.details;
	const update = useUpdateOrganization(organization.id);

	const form = useForm({
		defaultValues: {
			name: organization.name ?? "",
			address: organization.address ?? "",
			phone: organization.phone ?? "",
			email: organization.email ?? undefined,
			timezone: organization.timezone ?? "",
		} as UpdateOrganizationInput,
		validators: {
			onSubmit: updateOrganizationSchema,
			onSubmitAsync: async ({ value }) => {
				// Submit-time coercion: blank optional fields are omitted (R11.1).
				const payload: UpdateOrganizationInput = {
					name: emptyToUndefined(value.name),
					address: emptyToUndefined(value.address),
					phone: emptyToUndefined(value.phone),
					email: emptyToUndefined(value.email),
					timezone: emptyToUndefined(value.timezone),
				};
				try {
					await update.mutateAsync(payload);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						ORG_FIELDS as readonly string[],
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
			toast.success(copy.saved);
		},
	});

	return (
		<section className="rounded-lg border border-border bg-card p-6">
			<div className="space-y-1">
				<h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
				<p className="text-sm text-muted-foreground">{copy.description}</p>
			</div>

			<form
				noValidate
				className="mt-6 space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.name}</Label>
								<Input
									id={field.name}
									name={field.name}
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

				<form.Field name="address">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.address}</Label>
								<Input
									id={field.name}
									name={field.name}
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

				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="phone">
						{(field) => {
							const error = firstErrorMessage(field.state.meta.errors);
							return (
								<div className="space-y-2">
									<Label htmlFor={field.name}>{copy.fields.phone}</Label>
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

					<form.Field name="email">
						{(field) => {
							const error = firstErrorMessage(field.state.meta.errors);
							return (
								<div className="space-y-2">
									<Label htmlFor={field.name}>{copy.fields.email}</Label>
									<Input
										id={field.name}
										name={field.name}
										type="email"
										autoComplete="email"
										aria-invalid={error !== undefined}
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) =>
											field.handleChange(
												event.target.value === ""
													? undefined
													: event.target.value,
											)
										}
									/>
									{error ? (
										<p className="text-sm text-destructive">{error}</p>
									) : null}
								</div>
							);
						}}
					</form.Field>
				</div>

				<form.Field name="timezone">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.timezone}</Label>
								<Input
									id={field.name}
									name={field.name}
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : (
									<p className="text-sm text-muted-foreground">
										{copy.timezoneHint}
									</p>
								)}
							</div>
						);
					}}
				</form.Field>

				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? copy.submitPending : copy.submit}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</section>
	);
}
