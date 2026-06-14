/*
 * CounterForm — create/edit a counter (R9.2, R9.3, R9.6).
 *
 * Self-contained like the auth forms: it owns its react-hook-form instance and
 * the relevant mutation hook, validates with the shared Zod schemas
 * (`createCounterSchema` for create, `updateCounterSchema` for edit) via the Zod
 * resolver, disables submit while pending, and on failure maps backend
 * `error.details` onto fields (falling back to a code-mapped toast). A counter
 * must be associated with a service, so the form renders a service `<select>`
 * populated by the caller (R9.1, R9.2).
 */
import { useId, type ReactElement } from "react";
import { useForm, type Path, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { ICounter, IService } from "@queuenow/shared-types";
import {
	createCounterSchema,
	updateCounterSchema,
	type CreateCounterInput,
} from "@queuenow/shared-validation";

import { applyFieldErrors } from "@/features/auth/lib/field-errors";
import type { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useCreateCounter } from "../api/useCreateCounter";
import { useUpdateCounter } from "../api/useUpdateCounter";

/** Fields eligible for backend inline error mapping. */
const COUNTER_FIELDS: readonly Path<CreateCounterInput>[] = [
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
	const nameId = useId();
	const serviceId = useId();
	const activeId = useId();

	const createCounter = useCreateCounter({ orgId });
	const updateCounter = useUpdateCounter({ orgId });

	const resolver = (
		isEdit ? zodResolver(updateCounterSchema) : zodResolver(createCounterSchema)
	) as Resolver<CreateCounterInput>;

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<CreateCounterInput>({
		resolver,
		defaultValues: {
			serviceId: counter?.serviceId ?? services[0]?.id ?? "",
			name: counter?.name ?? "",
			isActive: counter?.isActive ?? true,
		},
	});

	const isPending = isEdit ? updateCounter.isPending : createCounter.isPending;

	const handleError = (error: ApiError): void => {
		const { mapped } = applyFieldErrors<CreateCounterInput>(
			error.details,
			COUNTER_FIELDS,
			setError,
		);
		if (mapped.length === 0) {
			toast.error(getErrorMessage(error));
		}
	};

	const onSubmit = handleSubmit((values) => {
		if (isEdit && counter) {
			updateCounter.mutate(
				{ id: counter.id, input: values },
				{
					onSuccess: () => {
						toast.success(copy.updateSuccess);
						onDone();
					},
					onError: handleError,
				},
			);
			return;
		}

		createCounter.mutate(values, {
			onSuccess: () => {
				toast.success(copy.createSuccess);
				onDone();
			},
			onError: handleError,
		});
	});

	return (
		<form
			noValidate
			onSubmit={onSubmit}
			className="space-y-4 rounded-lg border border-border p-4"
			aria-label={isEdit ? copy.editTitle : copy.createTitle}
		>
			<h2 className="text-lg font-semibold tracking-tight">
				{isEdit ? copy.editTitle : copy.createTitle}
			</h2>

			<div className="space-y-2">
				<Label htmlFor={nameId}>{copy.fields.name}</Label>
				<Input
					id={nameId}
					autoComplete="off"
					aria-invalid={errors.name !== undefined}
					aria-describedby={errors.name ? `${nameId}-error` : undefined}
					{...register("name")}
				/>
				{errors.name ? (
					<p id={`${nameId}-error`} className="text-sm text-destructive">
						{errors.name.message}
					</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label htmlFor={serviceId}>{copy.fields.service}</Label>
				<select
					id={serviceId}
					aria-invalid={errors.serviceId !== undefined}
					aria-describedby={errors.serviceId ? `${serviceId}-error` : undefined}
					className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
					{...register("serviceId")}
				>
					<option value="">{copy.fields.servicePlaceholder}</option>
					{services.map((service) => (
						<option key={service.id} value={service.id}>
							{service.name}
						</option>
					))}
				</select>
				{errors.serviceId ? (
					<p id={`${serviceId}-error`} className="text-sm text-destructive">
						{errors.serviceId.message}
					</p>
				) : null}
			</div>

			<div className="flex items-center gap-2">
				<input
					id={activeId}
					type="checkbox"
					className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					{...register("isActive")}
				/>
				<Label htmlFor={activeId}>{copy.fields.active}</Label>
			</div>

			<div className="flex items-center gap-2">
				<Button type="submit" disabled={isPending}>
					{isEdit
						? isPending
							? copy.submitEditPending
							: copy.submitEdit
						: isPending
							? copy.submitCreatePending
							: copy.submitCreate}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={isPending}
				>
					{copy.cancel}
				</Button>
			</div>
		</form>
	);
}
