/**
 * QueueSettingsForm — edit reset time, max recalls, required fields, and the
 * auto-skip timeout (R11.6).
 *
 * - Validation uses the shared `updateQueueSettingsSchema` via react-hook-form +
 *   the Zod resolver. Numbers coerce from the inputs; blanks become `undefined`.
 * - Booleans (`requireName` / `requirePhone`) use native checkboxes.
 * - On success a toast confirms. On failure, field errors map onto inputs with a
 *   code-mapped fallback toast (R11.8).
 */
import type { ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
	updateQueueSettingsSchema,
	type UpdateQueueSettingsInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyFieldErrors } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import type { QueueSettings } from "../types";
import { emptyToNumber } from "../lib/form-coerce";
import { useUpdateQueueSettings } from "../api/useUpdateQueueSettings";

/** Fields eligible for backend inline error mapping. */
const SETTINGS_FIELDS: readonly Path<UpdateQueueSettingsInput>[] = [
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

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<UpdateQueueSettingsInput>({
		resolver: zodResolver(updateQueueSettingsSchema),
		defaultValues: {
			resetTime: settings.resetTime ?? "00:00",
			maxRecall: settings.maxRecall ?? 2,
			requireName: settings.requireName ?? false,
			requirePhone: settings.requirePhone ?? false,
			autoSkipTimeout: settings.autoSkipTimeout ?? undefined,
		},
	});

	const onSubmit = handleSubmit((values) => {
		update.mutate(values, {
			onSuccess: () => {
				toast.success(copy.saved);
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<UpdateQueueSettingsInput>(
					error.details,
					SETTINGS_FIELDS,
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
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="settings-reset">{copy.fields.resetTime}</Label>
						<Input
							id="settings-reset"
							type="time"
							aria-invalid={errors.resetTime !== undefined}
							aria-describedby={
								errors.resetTime
									? "settings-reset-error"
									: "settings-reset-hint"
							}
							{...register("resetTime")}
						/>
						{errors.resetTime ? (
							<p id="settings-reset-error" className="text-sm text-destructive">
								{errors.resetTime.message}
							</p>
						) : (
							<p
								id="settings-reset-hint"
								className="text-sm text-muted-foreground"
							>
								{copy.resetTimeHint}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="settings-recall">{copy.fields.maxRecall}</Label>
						<Input
							id="settings-recall"
							type="number"
							min={1}
							max={5}
							step={1}
							aria-invalid={errors.maxRecall !== undefined}
							aria-describedby={
								errors.maxRecall
									? "settings-recall-error"
									: "settings-recall-hint"
							}
							{...register("maxRecall", { setValueAs: emptyToNumber })}
						/>
						{errors.maxRecall ? (
							<p
								id="settings-recall-error"
								className="text-sm text-destructive"
							>
								{errors.maxRecall.message}
							</p>
						) : (
							<p
								id="settings-recall-hint"
								className="text-sm text-muted-foreground"
							>
								{copy.maxRecallHint}
							</p>
						)}
					</div>
				</div>

				<div className="space-y-3 rounded-md border border-border p-4">
					<label
						htmlFor="settings-require-name"
						className="flex items-center gap-3 text-sm"
					>
						<input
							id="settings-require-name"
							type="checkbox"
							className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							{...register("requireName")}
						/>
						<span>{copy.fields.requireName}</span>
					</label>

					<label
						htmlFor="settings-require-phone"
						className="flex items-center gap-3 text-sm"
					>
						<input
							id="settings-require-phone"
							type="checkbox"
							className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							{...register("requirePhone")}
						/>
						<span>{copy.fields.requirePhone}</span>
					</label>
				</div>

				<div className="space-y-2">
					<Label htmlFor="settings-autoskip">
						{copy.fields.autoSkipTimeout}
					</Label>
					<Input
						id="settings-autoskip"
						type="number"
						min={1}
						step={1}
						aria-invalid={errors.autoSkipTimeout !== undefined}
						aria-describedby={
							errors.autoSkipTimeout ? "settings-autoskip-error" : undefined
						}
						{...register("autoSkipTimeout", { setValueAs: emptyToNumber })}
					/>
					{errors.autoSkipTimeout ? (
						<p
							id="settings-autoskip-error"
							className="text-sm text-destructive"
						>
							{errors.autoSkipTimeout.message}
						</p>
					) : null}
				</div>

				<Button type="submit" disabled={update.isPending}>
					{update.isPending ? copy.submitPending : copy.submit}
				</Button>
			</form>
		</section>
	);
}
