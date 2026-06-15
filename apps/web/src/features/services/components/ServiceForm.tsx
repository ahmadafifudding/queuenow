/*
 * ServiceForm — create/edit a service (R8.2, R8.3, R8.6).
 *
 * Validation reuses the shared `createServiceSchema` from
 * `@queuenow/shared-validation` via TanStack Form's Standard Schema validator;
 * the field types are inferred from the schema (no client-side redefinition).
 * The same field set drives both create and edit — the parent decides which
 * mutation runs (create validates with `createServiceSchema`, edit with
 * `updateServiceSchema`, enforced inside the mutation hooks).
 *
 * Submit is disabled while submitting. On failure, the parent's `onSubmit`
 * rejects with the typed `ApiError`; this form maps `error.details` onto the
 * matching fields as inline errors (returned from `onSubmitAsync`) and, when the
 * failure is not field-specific, shows a toast mapped from `error.code` (R8.6).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
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
import { firstErrorMessage, zodFormValidator } from "@/lib/forms";
import { strings } from "@/i18n";

import { toFieldErrors } from "@/features/auth";

/** Form fields eligible for backend inline error mapping. */
const SERVICE_FIELDS: readonly (keyof CreateServiceInput)[] = [
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

	const form = useForm({
		defaultValues: defaultValues ?? CREATE_DEFAULTS,
		validators: {
			onSubmit: zodFormValidator(createServiceSchema),
			onSubmitAsync: async ({ value }) => {
				try {
					await onSubmit(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						SERVICE_FIELDS as readonly string[],
					);
					if (mapped.length === 0) {
						const message = getErrorMessage(apiError ?? null);
						toast.error(message);
						return { form: message };
					}
					return { fields };
				}
			},
		},
		// Success side-effects (toast + close) are owned by the parent's onSubmit.
		onSubmit: () => {},
	});

	const title = mode === "create" ? copy.createTitle : copy.editTitle;
	const submitLabel = mode === "create" ? copy.submitCreate : copy.submitEdit;

	return (
		<form
			noValidate
			className="space-y-4 rounded-lg border border-border p-4"
			aria-label={title}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<h2 className="text-lg font-semibold tracking-tight">{title}</h2>

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

			<form.Field name="prefix">
				{(field) => {
					const error = firstErrorMessage(field.state.meta.errors);
					return (
						<div className="space-y-2">
							<Label htmlFor={field.name}>{copy.fields.prefix}</Label>
							<Input
								id={field.name}
								name={field.name}
								maxLength={3}
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

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<form.Field name="sortOrder">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.sortOrder}</Label>
								<Input
									id={field.name}
									name={field.name}
									type="number"
									inputMode="numeric"
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(Number(event.target.value))
									}
								/>
								{error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : null}
							</div>
						);
					}}
				</form.Field>

				<form.Field name="avgServingTime">
					{(field) => {
						const error = firstErrorMessage(field.state.meta.errors);
						return (
							<div className="space-y-2">
								<Label htmlFor={field.name}>{copy.fields.avgServingTime}</Label>
								<Input
									id={field.name}
									name={field.name}
									type="number"
									inputMode="numeric"
									min={1}
									aria-invalid={error !== undefined}
									value={field.state.value ?? ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(Number(event.target.value))
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

			<form.Field name="maxQueuePerDay">
				{(field) => {
					const error = firstErrorMessage(field.state.meta.errors);
					return (
						<div className="space-y-2">
							<Label htmlFor={field.name}>{copy.fields.maxQueuePerDay}</Label>
							<Input
								id={field.name}
								name={field.name}
								type="number"
								inputMode="numeric"
								min={1}
								aria-invalid={error !== undefined}
								value={field.state.value ?? ""}
								onBlur={field.handleBlur}
								onChange={(event) =>
									field.handleChange(
										event.target.value === ""
											? undefined
											: Number(event.target.value),
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

			<form.Field name="isActive">
				{(field) => (
					<div className="flex items-center gap-2">
						<input
							id={field.name}
							name={field.name}
							type="checkbox"
							className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							checked={field.state.value ?? false}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.checked)}
						/>
						<Label htmlFor={field.name}>{copy.fields.isActive}</Label>
					</div>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
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
				)}
			</form.Subscribe>
		</form>
	);
}
