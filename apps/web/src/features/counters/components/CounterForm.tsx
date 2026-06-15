/*
 * CounterForm — create/edit a counter (R9.2, R9.3, R9.6).
 *
 * Self-contained like the auth forms: it owns its TanStack Form instance and the
 * relevant mutation hook, validates with the shared Zod schemas
 * (`createCounterSchema` for create, `updateCounterSchema` for edit) via the
 * Standard Schema validator, disables submit while submitting, and on failure
 * maps backend `error.details` onto fields (falling back to a code-mapped
 * toast). A counter must be associated with a service, so the form renders a
 * service `<select>` populated by the caller (R9.1, R9.2).
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import type { ICounter, IService } from "@queuenow/shared-types";
import {
	createCounterSchema,
	updateCounterSchema,
	type CreateCounterInput,
} from "@queuenow/shared-validation";

import { toFieldErrors } from "@/features/auth/lib/field-errors";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage, zodFormValidator } from "@/lib/forms";
import { strings } from "@/i18n";

import { useCreateCounter } from "../api/useCreateCounter";
import { useUpdateCounter } from "../api/useUpdateCounter";

/** Fields eligible for backend inline error mapping. */
const COUNTER_FIELDS: readonly (keyof CreateCounterInput)[] = [
	"serviceId",
	"name",
	"isActive",
];

/** Props for {@link CounterForm}. */
export interface CounterFormProps {
	/** The organization the counter belongs to. */
	orgId: string;
	/** Active + inactive services to associate the counter with. */
	services: IService[];
	/** When provided, the form edits this counter; otherwise it creates a new one. */
	counter?: ICounter;
	/** Called after a successful create/edit so the parent can close the form. */
	onDone: () => void;
	/** Called when the user cancels the form. */
	onCancel: () => void;
}

/**
 * A create/edit form for a counter. Mode is derived from whether `counter` is
 * supplied.
 */
export function CounterForm({
	orgId,
	services,
	counter,
	onDone,
	onCancel,
}: CounterFormProps): ReactElement {
	const copy = strings.counters;
	const isEdit = counter !== undefined;

	const createCounter = useCreateCounter({ orgId });
	const updateCounter = useUpdateCounter({ orgId });

	const form = useForm({
		defaultValues: {
			serviceId: counter?.serviceId ?? services[0]?.id ?? "",
			name: counter?.name ?? "",
			isActive: counter?.isActive ?? true,
		} as CreateCounterInput,
		validators: {
			onSubmit: zodFormValidator(
				isEdit ? updateCounterSchema : createCounterSchema,
			),
			onSubmitAsync: async ({ value }) => {
				try {
					if (isEdit && counter) {
						await updateCounter.mutateAsync({ id: counter.id, input: value });
					} else {
						await createCounter.mutateAsync(value);
					}
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						COUNTER_FIELDS as readonly string[],
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
		onSubmit: () => {
			toast.success(isEdit ? copy.updateSuccess : copy.createSuccess);
			onDone();
		},
	});

	return (
		<form
			noValidate
			className="space-y-4 rounded-lg border border-border p-4"
			aria-label={isEdit ? copy.editTitle : copy.createTitle}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<h2 className="text-lg font-semibold tracking-tight">
				{isEdit ? copy.editTitle : copy.createTitle}
			</h2>

			<form.Field name="name">
				{(field) => {
					const error = firstErrorMessage(field.state.meta.errors);
					return (
						<div className="space-y-2">
							<Label htmlFor={field.name}>{copy.fields.name}</Label>
							<Input
								id={field.name}
								name={field.name}
								autoComplete="off"
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

			<form.Field name="serviceId">
				{(field) => {
					const error = firstErrorMessage(field.state.meta.errors);
					return (
						<div className="space-y-2">
							<Label htmlFor={field.name}>{copy.fields.service}</Label>
							<select
								id={field.name}
								name={field.name}
								aria-invalid={error !== undefined}
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
								value={field.state.value ?? ""}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							>
								<option value="">{copy.fields.servicePlaceholder}</option>
								{services.map((service) => (
									<option key={service.id} value={service.id}>
										{service.name}
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
						<Label htmlFor={field.name}>{copy.fields.active}</Label>
					</div>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex items-center gap-2">
						<Button type="submit" disabled={isSubmitting}>
							{isEdit
								? isSubmitting
									? copy.submitEditPending
									: copy.submitEdit
								: isSubmitting
									? copy.submitCreatePending
									: copy.submitCreate}
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
