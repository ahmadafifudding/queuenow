/*
 * ServiceForm — create/edit a service (R8.2, R8.3, R8.6).
 *
 * Validation reuses the shared `createServiceSchema` from
 * `@queuenow/shared-validation` via react-hook-form + the Zod resolver; the
 * field types are inferred from the schema (no client-side redefinition). The
 * same field set drives both create and edit — the parent decides which
 * mutation runs (create validates with `createServiceSchema`, edit with
 * `updateServiceSchema`, enforced inside the mutation hooks).
 *
 * Submit is disabled while pending. On failure, the parent's `onSubmit` rejects
 * with the typed `ApiError`; this form maps `error.details` onto the matching
 * fields as inline errors and, when the failure is not field-specific, shows a
 * toast mapped from `error.code` (R8.6).
 */
import { useId, type ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
	createServiceSchema,
	type CreateServiceInput,
} from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { applyFieldErrors } from "@/features/auth";

/** Form fields eligible for backend inline error mapping. */
const SERVICE_FIELDS: readonly Path<CreateServiceInput>[] = [
	"name",
	"prefix",
	"sortOrder",
	"avgServingTime",
	"maxQueuePerDay",
	"isActive",
];

/** Sensible empty defaults for the create form (mirror the schema defaults). */
const CREATE_DEFAULTS: CreateServiceInput = {
	name: "",
	prefix: "",
	isActive: true,
	sortOrder: 0,
	avgServingTime: 5,
};

/** Props for {@link ServiceForm}. */
export interface ServiceFormProps {
	/** `create` shows the create copy/submit; `edit` shows the edit copy/submit. */
	mode: "create" | "edit";
	/** Initial values (used for the edit form; falls back to empty create defaults). */
	defaultValues?: CreateServiceInput;
	/**
	 * Performs the mutation. Resolves on success (the parent then toasts + closes);
	 * rejects with an `ApiError` on failure so this form can map field errors.
	 */
	onSubmit: (values: CreateServiceInput) => Promise<void>;
	/** Dismiss the form without submitting. */
	onCancel: () => void;
}

/**
 * A controlled create/edit form for a single service.
 */
export function ServiceForm({
	mode,
	defaultValues,
	onSubmit,
	onCancel,
}: ServiceFormProps): ReactElement {
	const copy = strings.services.form;
	const baseId = useId();
	const fieldId = (field: string): string => `${baseId}-${field}`;
	const errorId = (field: string): string => `${baseId}-${field}-error`;

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm<CreateServiceInput>({
		resolver: zodResolver(createServiceSchema),
		defaultValues: defaultValues ?? CREATE_DEFAULTS,
	});

	const submit = handleSubmit(async (values) => {
		try {
			await onSubmit(values);
		} catch (error) {
			if (error instanceof ApiError) {
				const { mapped } = applyFieldErrors<CreateServiceInput>(
					error.details,
					SERVICE_FIELDS,
					setError,
				);
				if (mapped.length === 0) {
					toast.error(getErrorMessage(error));
				}
			} else {
				toast.error(getErrorMessage(null));
			}
		}
	});

	const title = mode === "create" ? copy.createTitle : copy.editTitle;
	const submitLabel = mode === "create" ? copy.submitCreate : copy.submitEdit;

	return (
		<form
			noValidate
			onSubmit={submit}
			className="space-y-4 rounded-lg border border-border p-4"
			aria-label={title}
		>
			<h2 className="text-lg font-semibold tracking-tight">{title}</h2>

			<div className="space-y-2">
				<Label htmlFor={fieldId("name")}>{copy.fields.name}</Label>
				<Input
					id={fieldId("name")}
					aria-invalid={errors.name !== undefined}
					aria-describedby={errors.name ? errorId("name") : undefined}
					{...register("name")}
				/>
				{errors.name ? (
					<p id={errorId("name")} className="text-sm text-destructive">
						{errors.name.message}
					</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label htmlFor={fieldId("prefix")}>{copy.fields.prefix}</Label>
				<Input
					id={fieldId("prefix")}
					maxLength={3}
					aria-invalid={errors.prefix !== undefined}
					aria-describedby={errors.prefix ? errorId("prefix") : undefined}
					{...register("prefix")}
				/>
				{errors.prefix ? (
					<p id={errorId("prefix")} className="text-sm text-destructive">
						{errors.prefix.message}
					</p>
				) : null}
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor={fieldId("sortOrder")}>{copy.fields.sortOrder}</Label>
					<Input
						id={fieldId("sortOrder")}
						type="number"
						inputMode="numeric"
						aria-invalid={errors.sortOrder !== undefined}
						aria-describedby={
							errors.sortOrder ? errorId("sortOrder") : undefined
						}
						{...register("sortOrder", {
							setValueAs: (v) => (v === "" ? undefined : Number(v)),
						})}
					/>
					{errors.sortOrder ? (
						<p id={errorId("sortOrder")} className="text-sm text-destructive">
							{errors.sortOrder.message}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor={fieldId("avgServingTime")}>
						{copy.fields.avgServingTime}
					</Label>
					<Input
						id={fieldId("avgServingTime")}
						type="number"
						inputMode="numeric"
						min={1}
						aria-invalid={errors.avgServingTime !== undefined}
						aria-describedby={
							errors.avgServingTime ? errorId("avgServingTime") : undefined
						}
						{...register("avgServingTime", {
							setValueAs: (v) => (v === "" ? undefined : Number(v)),
						})}
					/>
					{errors.avgServingTime ? (
						<p
							id={errorId("avgServingTime")}
							className="text-sm text-destructive"
						>
							{errors.avgServingTime.message}
						</p>
					) : null}
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor={fieldId("maxQueuePerDay")}>
					{copy.fields.maxQueuePerDay}
				</Label>
				<Input
					id={fieldId("maxQueuePerDay")}
					type="number"
					inputMode="numeric"
					min={1}
					aria-invalid={errors.maxQueuePerDay !== undefined}
					aria-describedby={
						errors.maxQueuePerDay ? errorId("maxQueuePerDay") : undefined
					}
					{...register("maxQueuePerDay", {
						setValueAs: (v) => (v === "" ? undefined : Number(v)),
					})}
				/>
				{errors.maxQueuePerDay ? (
					<p
						id={errorId("maxQueuePerDay")}
						className="text-sm text-destructive"
					>
						{errors.maxQueuePerDay.message}
					</p>
				) : null}
			</div>

			<div className="flex items-center gap-2">
				<input
					id={fieldId("isActive")}
					type="checkbox"
					className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					{...register("isActive")}
				/>
				<Label htmlFor={fieldId("isActive")}>{copy.fields.isActive}</Label>
			</div>

			<div className="flex items-center gap-2">
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? copy.submitPending : submitLabel}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={isSubmitting}
				>
					{copy.cancel}
				</Button>
			</div>
		</form>
	);
}
