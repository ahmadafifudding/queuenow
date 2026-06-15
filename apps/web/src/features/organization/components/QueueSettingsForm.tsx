/**
 * QueueSettingsForm — edit reset time, max recalls, required fields, and the
 * auto-skip timeout (R11.6).
 *
 * - Validation uses the shared `updateQueueSettingsSchema` via TanStack Form's
 *   Standard Schema validator. Number fields store a `number | undefined` in
 *   field state (coerced via `emptyToNumber`) since the schema uses `z.number()`;
 *   `resetTime` stays a string; `requireName`/`requirePhone` are booleans.
 * - On success a toast confirms. On failure, field errors map onto inputs
 *   (returned from `onSubmitAsync`) with a code-mapped fallback toast (R11.8).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
	updateQueueSettingsSchema,
	type UpdateQueueSettingsInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toFieldErrors } from "@/features/auth";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage } from "@/lib/forms";
import { strings } from "@/i18n";

import type { QueueSettings } from "../types";
import { emptyToNumber } from "../lib/form-coerce";
import { useUpdateQueueSettings } from "../api/useUpdateQueueSettings";

/** Fields eligible for backend inline error mapping. */
const SETTINGS_FIELDS: readonly (keyof UpdateQueueSettingsInput)[] = [
	"resetTime",
	"maxRecall",
	"requireName",
	"requirePhone",
	"autoSkipTimeout",
];

export interface QueueSettingsFormProps {
	/** The organization whose settings are being edited. */
	orgId: string;
	/** Current queue settings used as the form's initial values. */
	settings: QueueSettings;
}

export function QueueSettingsForm({
	orgId,
	settings,
}: QueueSettingsFormProps): ReactElement {
	const copy = strings.organization.queueSettings;
	const update = useUpdateQueueSettings(orgId);

	const form = useForm({
		defaultValues: {
			resetTime: settings.resetTime ?? "00:00",
			maxRecall: settings.maxRecall ?? 2,
			requireName: settings.requireName ?? false,
			requirePhone: settings.requirePhone ?? false,
			autoSkipTimeout: settings.autoSkipTimeout ?? undefined,
		} as UpdateQueueSettingsInput,
		validators: {
			onSubmit: updateQueueSettingsSchema,
			onSubmitAsync: async ({ value }) => {
				try {
					await update.mutateAsync(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						SETTINGS_FIELDS as readonly string[],
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
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="resetTime">
						{(field) => {
							const error = firstErrorMessage(field.state.meta.errors);
							return (
								<div className="space-y-2">
									<Label htmlFor={field.name}>{copy.fields.resetTime}</Label>
									<Input
										id={field.name}
										name={field.name}
										type="time"
										aria-invalid={error !== undefined}
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									{error ? (
										<p className="text-sm text-destructive">{error}</p>
									) : (
										<p className="text-sm text-muted-foreground">
											{copy.resetTimeHint}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>

					<form.Field name="maxRecall">
						{(field) => {
							const error = firstErrorMessage(field.state.meta.errors);
							return (
								<div className="space-y-2">
									<Label htmlFor={field.name}>{copy.fields.maxRecall}</Label>
									<Input
										id={field.name}
										name={field.name}
										type="number"
										min={1}
										max={5}
										step={1}
										aria-invalid={error !== undefined}
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) =>
											field.handleChange(emptyToNumber(event.target.value))
										}
									/>
									{error ? (
										<p className="text-sm text-destructive">{error}</p>
									) : (
										<p className="text-sm text-muted-foreground">
											{copy.maxRecallHint}
										</p>
									)}
								</div>
							);
						}}
					</form.Field>
				</div>

				<div className="space-y-3 rounded-md border border-border p-4">
					<form.Field name="requireName">
						{(field) => (
							<label
								htmlFor={field.name}
								className="flex items-center gap-3 text-sm"
							>
								<input
									id={field.name}
									name={field.name}
									type="checkbox"
									className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									checked={field.state.value ?? false}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>
								<span>{copy.fields.requireName}</span>
							</label>
						)}
					</form.Field>

					<form.Field name="requirePhone">
						{(field) => (
							<label
								htmlFor={field.name}
								className="flex items-center gap-3 text-sm"
							>
								<input
									id={field.name}
									name={field.name}
									type="checkbox"
									className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									checked={field.state.value ?? false}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>
								<span>{copy.fields.requirePhone}</span>
							</label>
						)}
					</form.Field>
				</div>

				<form.Field name="autoSkipTimeout">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{copy.fields.autoSkipTimeout}
								</Label>
								<Input
									id={field.name}
									name={field.name}
									type="number"
									min={1}
									step={1}
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(emptyToNumber(event.target.value))
									}
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
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? copy.submitPending : copy.submit}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</section>
	);
}
