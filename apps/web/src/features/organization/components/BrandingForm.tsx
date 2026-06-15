/**
 * BrandingForm — edit logo URL, primary color, and kiosk QR caption (R11.2).
 *
 * - Validation uses the shared `updateBrandingSchema` (hex `primaryColor`,
 *   URL `logoUrl`) via TanStack Form's Standard Schema validator.
 * - The primary color uses a native color picker plus a text input bound to the
 *   same `primaryColor` field so the value stays a `#RRGGBB` hex string the
 *   schema accepts.
 * - Constrained-optional fields hold `undefined` (not `''`) when blank so they
 *   pass `.url()` / the hex regex; empties are simply omitted from the payload.
 * - On success the mutation re-applies the brand color at runtime (R11.3) and a
 *   toast confirms. On failure, field errors map onto inputs (returned from
 *   `onSubmitAsync`) with a code-mapped fallback toast (R11.8).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
	updateBrandingSchema,
	type UpdateBrandingInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toFieldErrors } from "@/features/auth";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage } from "@/lib/forms";
import { strings } from "@/i18n";

import type { OrganizationBranding } from "../types";
import { useUpdateBranding } from "../api/useUpdateBranding";

/** Fields eligible for backend inline error mapping. */
const BRANDING_FIELDS: readonly (keyof UpdateBrandingInput)[] = [
	"logoUrl",
	"primaryColor",
	"qrText",
];

/** Fallback used by the color picker when no brand color is set yet. */
const DEFAULT_PRIMARY_HEX = "#3B82F6";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Empty string → `undefined`, so a blank constrained field is omitted. */
function blankToUndefined(value: string): string | undefined {
	return value === "" ? undefined : value;
}

export interface BrandingFormProps {
	/** The organization whose branding is being edited. */
	orgId: string;
	/** The organization's current branding (may be null before first configured). */
	branding: OrganizationBranding | null | undefined;
}

export function BrandingForm({
	orgId,
	branding,
}: BrandingFormProps): ReactElement {
	const copy = strings.organization.branding;
	const update = useUpdateBranding(orgId);

	const form = useForm({
		defaultValues: {
			logoUrl: branding?.logoUrl ?? undefined,
			primaryColor: branding?.primaryColor ?? undefined,
			qrText: branding?.qrText ?? undefined,
		} as UpdateBrandingInput,
		validators: {
			onSubmit: updateBrandingSchema,
			onSubmitAsync: async ({ value }) => {
				try {
					await update.mutateAsync(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						BRANDING_FIELDS as readonly string[],
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
				<form.Field name="logoUrl">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.logoUrl}</Label>
								<Input
									id={field.name}
									name={field.name}
									type="url"
									inputMode="url"
									placeholder="https://…"
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(blankToUndefined(event.target.value))
									}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : null}
							</div>
						);
					}}
				</form.Field>

				<form.Field name="primaryColor">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						const value = field.state.value ?? "";
						const pickerValue = HEX_COLOR.test(value)
							? value
							: DEFAULT_PRIMARY_HEX;
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.primaryColor}</Label>
								<div className="flex items-center gap-3">
									<input
										type="color"
										aria-label={copy.fields.primaryColor}
										className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
										value={pickerValue}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									<Input
										id={field.name}
										name={field.name}
										placeholder={DEFAULT_PRIMARY_HEX}
										aria-invalid={error !== undefined}
										value={value}
										onBlur={field.handleBlur}
										onChange={(event) =>
											field.handleChange(blankToUndefined(event.target.value))
										}
									/>
								</div>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : (
									<p className="text-sm text-muted-foreground">
										{copy.primaryColorHint}
									</p>
								)}
							</div>
						);
					}}
				</form.Field>

				<form.Field name="qrText">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.qrText}</Label>
								<Input
									id={field.name}
									name={field.name}
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(blankToUndefined(event.target.value))
									}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : (
									<p className="text-sm text-muted-foreground">
										{copy.qrTextHint}
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
