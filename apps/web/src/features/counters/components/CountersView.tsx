/*
 * CountersView — the counters management surface (R9.1–R9.7).
 *
 * Responsibilities (task 12.1):
 * - Read the active org from the Auth_Store (the route already gates this to
 *   OWNER/ADMIN via `beforeLoad`, R5.6) and load the counters + services lists.
 * - Render the counters list (name, associated service, active) inside the
 *   shared `<DataRegion>` with explicit loading / empty / error states (R9.1,
 *   R9.7).
 * - Own the create/edit form visibility and the active-toggle mutation, mapping
 *   failures to friendly, code-based toasts (R9.4, R9.6). Create/edit validation
 *   and field-error mapping live in `<CounterForm>` (R9.2, R9.3).
 *
 * Mutations invalidate `['counters', orgId]` on success (in the mutation hooks),
 * so this view never writes the cache directly (R9.5).
 */
import { useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import type { ICounter } from "@queuenow/shared-types";

import { DataRegion } from "@/components/DataRegion";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useCounters } from "../api/useCounters";
import { useServices } from "../api/useServices";
import { useToggleCounter } from "../api/useToggleCounter";
import { CounterForm } from "./CounterForm";
import { CounterList } from "./CounterList";

/** Which form, if any, is open. */
type FormState =
	| { readonly kind: "closed" }
	| { readonly kind: "create" }
	| { readonly kind: "edit"; readonly counter: ICounter };

/**
 * The counters management view: list + create/edit form + active toggle.
 */
export function CountersView(): ReactElement {
	const copy = strings.counters;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const hasOrg = Boolean(orgId);
	const safeOrgId = orgId ?? "";

	const [form, setForm] = useState<FormState>({ kind: "closed" });

	const countersQuery = useCounters({ orgId: safeOrgId, enabled: hasOrg });
	const servicesQuery = useServices({ orgId: safeOrgId, enabled: hasOrg });
	const toggleCounter = useToggleCounter({ orgId: safeOrgId });

	const services = useMemo(
		() => servicesQuery.data ?? [],
		[servicesQuery.data],
	);

	const serviceNameFor = (serviceId: string): string =>
		services.find((service) => service.id === serviceId)?.name ??
		copy.unknownService;

	const handleToggle = (counter: ICounter, nextActive: boolean): void => {
		toggleCounter.mutate(
			{ id: counter.id, isActive: nextActive },
			{
				onSuccess: () => {
					toast.success(
						nextActive ? copy.activateSuccess : copy.deactivateSuccess,
					);
				},
				onError: (error) => {
					toast.error(getErrorMessage(error));
				},
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

	const hasServices = services.length > 0;
	const togglingId = toggleCounter.isPending
		? (toggleCounter.variables?.id ?? null)
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
				{form.kind === "closed" ? (
					<Button
						type="button"
						onClick={() => setForm({ kind: "create" })}
						disabled={!hasServices}
					>
						{copy.newCounter}
					</Button>
				) : null}
			</header>

			{servicesQuery.isError ? (
				<p role="alert" className="text-sm text-destructive">
					{copy.servicesError}
				</p>
			) : null}

			{!servicesQuery.isLoading && !servicesQuery.isError && !hasServices ? (
				<p className="text-sm text-muted-foreground">{copy.noServices}</p>
			) : null}

			{form.kind === "create" ? (
				<CounterForm
					orgId={safeOrgId}
					services={services}
					onDone={() => setForm({ kind: "closed" })}
					onCancel={() => setForm({ kind: "closed" })}
				/>
			) : null}

			{form.kind === "edit" ? (
				<CounterForm
					orgId={safeOrgId}
					services={services}
					counter={form.counter}
					onDone={() => setForm({ kind: "closed" })}
					onCancel={() => setForm({ kind: "closed" })}
				/>
			) : null}

			<DataRegion<ICounter[]>
				isLoading={countersQuery.isLoading}
				isError={countersQuery.isError}
				error={countersQuery.error}
				data={countersQuery.data}
				isEmpty={(countersQuery.data?.length ?? 0) === 0}
				emptyMessage={copy.empty}
				errorMessage={getErrorMessage(countersQuery.error)}
				onRetry={() => {
					void countersQuery.refetch();
				}}
				loadingLabel={copy.title}
			>
				{(counters) => (
					<CounterList
						counters={counters}
						serviceNameFor={serviceNameFor}
						onEdit={(counter) => setForm({ kind: "edit", counter })}
						onToggle={handleToggle}
						togglingId={togglingId}
					/>
				)}
			</DataRegion>
		</main>
	);
}
