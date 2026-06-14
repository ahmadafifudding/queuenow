/*
 * ServicesView — the services management surface (R8.1–R8.7).
 *
 * Wires the pieces together:
 * - Reads the active org from the Auth_Store.
 * - Lists services via `useServices` inside the shared `<DataRegion>` with
 *   explicit loading / empty / error states (R8.1, R8.7).
 * - Opens a create or edit `<ServiceForm>` validated by the shared schemas
 *   (R8.2, R8.3); the create/edit mutation hooks invalidate `['services', orgId]`
 *   on success so the list refreshes (R8.5).
 * - Toggles a service's active state via `useToggleService` (R8.4), toasting a
 *   code-mapped message on failure (R8.6).
 *
 * The route already gates this surface to OWNER/ADMIN (steering capability
 * matrix, R5.6) via `requireRole` in `routes/_authenticated/services.tsx`.
 */
import { useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import type { IService } from "@queuenow/shared-types";
import type { CreateServiceInput } from "@queuenow/shared-validation";

import { DataRegion } from "@/components/DataRegion";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useServices } from "../api/useServices";
import { useCreateService } from "../api/useCreateService";
import { useUpdateService } from "../api/useUpdateService";
import { useToggleService } from "../api/useToggleService";
import { ServiceForm } from "./ServiceForm";
import { ServicesList } from "./ServicesList";

/** The form's open/closed state: closed, creating, or editing a given service. */
type FormState =
	| { readonly type: "closed" }
	| { readonly type: "create" }
	| { readonly type: "edit"; readonly service: IService };

/** Map a service record to the form's value shape (null → undefined). */
function toFormValues(service: IService): CreateServiceInput {
	return {
		name: service.name,
		prefix: service.prefix,
		isActive: service.isActive,
		sortOrder: service.sortOrder,
		avgServingTime: service.avgServingTime,
		maxQueuePerDay: service.maxQueuePerDay ?? undefined,
	};
}

/**
 * The services management view. Reads the active org, lists services, and hosts
 * the create/edit form plus the active-state toggle.
 */
export function ServicesView(): ReactElement {
	const copy = strings.services;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const hasOrg = Boolean(orgId);
	const safeOrgId = orgId ?? "";

	const [form, setForm] = useState<FormState>({ type: "closed" });

	const servicesQuery = useServices({ orgId: safeOrgId, enabled: hasOrg });
	const createService = useCreateService({ orgId: safeOrgId });
	const updateService = useUpdateService({ orgId: safeOrgId });
	const toggleService = useToggleService({ orgId: safeOrgId });

	// Stable, presentation-friendly ordering: by sortOrder then name (R8.1).
	const sortedServices = useMemo(() => {
		const list = servicesQuery.data ?? [];
		return [...list].sort(
			(a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
		);
	}, [servicesQuery.data]);

	const closeForm = (): void => setForm({ type: "closed" });

	const handleCreate = async (values: CreateServiceInput): Promise<void> => {
		await createService.mutateAsync(values);
		toast.success(copy.form.createSuccess);
		closeForm();
	};

	const handleEdit =
		(id: string) =>
		async (values: CreateServiceInput): Promise<void> => {
			await updateService.mutateAsync({ id, input: values });
			toast.success(copy.form.editSuccess);
			closeForm();
		};

	const handleToggle = (service: IService): void => {
		const nextActive = !service.isActive;
		toggleService.mutate(
			{ id: service.id, isActive: nextActive },
			{
				onSuccess: () =>
					toast.success(
						nextActive
							? copy.form.activateSuccess
							: copy.form.deactivateSuccess,
					),
				onError: (error) => toast.error(getErrorMessage(error)),
			},
		);
	};

	if (!hasOrg) {
		return (
			<main className="mx-auto max-w-5xl p-8">
				<p className="text-sm text-muted-foreground">{copy.noOrganization}</p>
			</main>
		);
	}

	const togglingId = toggleService.isPending
		? (toggleService.variables?.id ?? null)
		: null;

	return (
		<main className="mx-auto max-w-5xl space-y-6 p-8">
			<header className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{copy.title}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
				</div>
				{form.type === "closed" ? (
					<Button type="button" onClick={() => setForm({ type: "create" })}>
						{copy.actions.create}
					</Button>
				) : null}
			</header>

			{form.type === "create" ? (
				<ServiceForm
					mode="create"
					onSubmit={handleCreate}
					onCancel={closeForm}
				/>
			) : null}

			{form.type === "edit" ? (
				<ServiceForm
					mode="edit"
					defaultValues={toFormValues(form.service)}
					onSubmit={handleEdit(form.service.id)}
					onCancel={closeForm}
				/>
			) : null}

			<DataRegion<IService[]>
				isLoading={servicesQuery.isLoading}
				isError={servicesQuery.isError}
				error={servicesQuery.error}
				data={sortedServices}
				isEmpty={sortedServices.length === 0}
				emptyMessage={copy.empty}
				errorMessage={getErrorMessage(servicesQuery.error)}
				onRetry={() => {
					void servicesQuery.refetch();
				}}
				loadingLabel={copy.title}
			>
				{(services) => (
					<ServicesList
						services={services}
						onEdit={(service) => setForm({ type: "edit", service })}
						onToggle={handleToggle}
						togglingId={togglingId}
					/>
				)}
			</DataRegion>
		</main>
	);
}
