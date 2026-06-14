/**
 * OrganizationDetailsForm — edit org name/address/phone/email/timezone (R11.1).
 *
 * - Validation uses the shared `updateOrganizationSchema` via react-hook-form +
 *   the Zod resolver; field types are inferred from the schema (no client-side
 *   redefinition of the rules).
 * - Optional fields are coerced from `''` → `undefined` so leaving them blank
 *   omits them rather than failing `.email()`.
 * - Submit is disabled while the mutation is pending.
 * - On success: a success toast shows. On failure: backend `error.details` map
 *   onto the matching fields; a non-field error surfaces a code-mapped toast
 *   (R11.8).
 */
import type { ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
	updateOrganizationSchema,
	type UpdateOrganizationInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyFieldErrors } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import type { OrganizationDetails } from "../types";
import { emptyToUndefined } from "../lib/form-coerce";
import { useUpdateOrganization } from "../api/useUpdateOrganization";

/** Fields eligible for backend inline error mapping. */
const ORG_FIELDS: readonly Path<UpdateOrganizationInput>[] = [
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

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<UpdateOrganizationInput>({
		resolver: zodResolver(updateOrganizationSchema),
		defaultValues: {
			name: organization.name ?? "",
			address: organization.address ?? "",
			phone: organization.phone ?? "",
			email: organization.email ?? "",
			timezone: organization.timezone ?? "",
		},
	});

	const onSubmit = handleSubmit((values) => {
		update.mutate(values, {
			onSuccess: () => {
				toast.success(copy.saved);
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<UpdateOrganizationInput>(
					error.details,
					ORG_FIELDS,
					setError,
				);
				if (mapped.length === 0) {
					toast.error(getErrorMessage(error));
				}
			},
		});
	});

	return (
		<section className="rounded-lg border border-border bg-card p-6">
			<div className="space-y-1">
				<h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
				<p className="text-sm text-muted-foreground">{copy.description}</p>
			</div>

			<form noValidate onSubmit={onSubmit} className="mt-6 space-y-4">
				<div className="space-y-2">
					<Label htmlFor="org-name">{copy.fields.name}</Label>
					<Input
						id="org-name"
						aria-invalid={errors.name !== undefined}
						aria-describedby={errors.name ? "org-name-error" : undefined}
						{...register("name", { setValueAs: emptyToUndefined })}
					/>
					{errors.name ? (
						<p id="org-name-error" className="text-sm text-destructive">
							{errors.name.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="org-address">{copy.fields.address}</Label>
					<Input
						id="org-address"
						aria-invalid={errors.address !== undefined}
						aria-describedby={errors.address ? "org-address-error" : undefined}
						{...register("address", { setValueAs: emptyToUndefined })}
					/>
					{errors.address ? (
						<p id="org-address-error" className="text-sm text-destructive">
							{errors.address.message}
						</p>
					) : null}
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="org-phone">{copy.fields.phone}</Label>
						<Input
							id="org-phone"
							type="tel"
							autoComplete="tel"
							aria-invalid={errors.phone !== undefined}
							aria-describedby={errors.phone ? "org-phone-error" : undefined}
							{...register("phone", { setValueAs: emptyToUndefined })}
						/>
						{errors.phone ? (
							<p id="org-phone-error" className="text-sm text-destructive">
								{errors.phone.message}
							</p>
						) : null}
					</div>

					<div className="space-y-2">
						<Label htmlFor="org-email">{copy.fields.email}</Label>
						<Input
							id="org-email"
							type="email"
							autoComplete="email"
							aria-invalid={errors.email !== undefined}
							aria-describedby={errors.email ? "org-email-error" : undefined}
							{...register("email", { setValueAs: emptyToUndefined })}
						/>
						{errors.email ? (
							<p id="org-email-error" className="text-sm text-destructive">
								{errors.email.message}
							</p>
						) : null}
					</div>
				</div>

				<div className="space-y-2">
					<Label htmlFor="org-timezone">{copy.fields.timezone}</Label>
					<Input
						id="org-timezone"
						aria-invalid={errors.timezone !== undefined}
						aria-describedby={
							errors.timezone ? "org-timezone-error" : "org-timezone-hint"
						}
						{...register("timezone", { setValueAs: emptyToUndefined })}
					/>
					{errors.timezone ? (
						<p id="org-timezone-error" className="text-sm text-destructive">
							{errors.timezone.message}
						</p>
					) : (
						<p id="org-timezone-hint" className="text-sm text-muted-foreground">
							{copy.timezoneHint}
						</p>
					)}
				</div>

				<Button type="submit" disabled={update.isPending}>
					{update.isPending ? copy.submitPending : copy.submit}
				</Button>
			</form>
		</section>
	);
}
