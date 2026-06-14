/**
 * BrandingForm — edit logo URL, primary color, and kiosk QR caption (R11.2).
 *
 * - Validation uses the shared `updateBrandingSchema` (hex `primaryColor`,
 *   URL `logoUrl`) via react-hook-form + the Zod resolver.
 * - The primary color uses a native color picker plus a text input bound to the
 *   same field so the value stays a `#RRGGBB` hex string the schema accepts.
 * - On success the mutation re-applies the brand color at runtime (R11.3) and a
 *   toast confirms. On failure, field errors map onto inputs with a code-mapped
 *   fallback toast (R11.8).
 */
import type { ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
	updateBrandingSchema,
	type UpdateBrandingInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyFieldErrors } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import type { OrganizationBranding } from "../types";
import { emptyToUndefined } from "../lib/form-coerce";
import { useUpdateBranding } from "../api/useUpdateBranding";

/** Fields eligible for backend inline error mapping. */
const BRANDING_FIELDS: readonly Path<UpdateBrandingInput>[] = [
	"logoUrl",
	"primaryColor",
	"qrText",
];

/** Fallback used by the color picker when no brand color is set yet. */
const DEFAULT_PRIMARY_HEX = "#3B82F6";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

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

	const {
		register,
		handleSubmit,
		setError,
		control,
		formState: { errors },
	} = useForm<UpdateBrandingInput>({
		resolver: zodResolver(updateBrandingSchema),
		defaultValues: {
			logoUrl: branding?.logoUrl ?? "",
			primaryColor: branding?.primaryColor ?? "",
			qrText: branding?.qrText ?? "",
		},
	});

	const onSubmit = handleSubmit((values) => {
		update.mutate(values, {
			onSuccess: () => {
				toast.success(copy.saved);
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<UpdateBrandingInput>(
					error.details,
					BRANDING_FIELDS,
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
					<Label htmlFor="branding-logo">{copy.fields.logoUrl}</Label>
					<Input
						id="branding-logo"
						type="url"
						inputMode="url"
						placeholder="https://…"
						aria-invalid={errors.logoUrl !== undefined}
						aria-describedby={
							errors.logoUrl ? "branding-logo-error" : undefined
						}
						{...register("logoUrl", { setValueAs: emptyToUndefined })}
					/>
					{errors.logoUrl ? (
						<p id="branding-logo-error" className="text-sm text-destructive">
							{errors.logoUrl.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="branding-color">{copy.fields.primaryColor}</Label>
					<Controller
						control={control}
						name="primaryColor"
						render={({ field }) => {
							const value = field.value ?? "";
							const pickerValue = HEX_COLOR.test(value)
								? value
								: DEFAULT_PRIMARY_HEX;
							return (
								<div className="flex items-center gap-3">
									<input
										type="color"
										aria-label={copy.fields.primaryColor}
										className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
										value={pickerValue}
										onChange={(event) => field.onChange(event.target.value)}
									/>
									<Input
										id="branding-color"
										placeholder={DEFAULT_PRIMARY_HEX}
										aria-invalid={errors.primaryColor !== undefined}
										aria-describedby={
											errors.primaryColor
												? "branding-color-error"
												: "branding-color-hint"
										}
										value={value}
										onChange={(event) => field.onChange(event.target.value)}
										onBlur={field.onBlur}
										name={field.name}
										ref={field.ref}
									/>
								</div>
							);
						}}
					/>
					{errors.primaryColor ? (
						<p id="branding-color-error" className="text-sm text-destructive">
							{errors.primaryColor.message}
						</p>
					) : (
						<p
							id="branding-color-hint"
							className="text-sm text-muted-foreground"
						>
							{copy.primaryColorHint}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="branding-qr">{copy.fields.qrText}</Label>
					<Input
						id="branding-qr"
						aria-invalid={errors.qrText !== undefined}
						aria-describedby={
							errors.qrText ? "branding-qr-error" : "branding-qr-hint"
						}
						{...register("qrText", { setValueAs: emptyToUndefined })}
					/>
					{errors.qrText ? (
						<p id="branding-qr-error" className="text-sm text-destructive">
							{errors.qrText.message}
						</p>
					) : (
						<p id="branding-qr-hint" className="text-sm text-muted-foreground">
							{copy.qrTextHint}
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
