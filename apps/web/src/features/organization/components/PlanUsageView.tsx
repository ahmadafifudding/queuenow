/**
 * PlanUsageView — the Plan & Usage surface (R8.1–R8.4, R8.6).
 *
 * Reads the server-computed plan-usage projection through `usePlanUsage` and
 * mirrors it for display:
 *   - the organization's current plan name (R8.1);
 *   - per-resource usage vs. limit as "{usage} / {limit}", or "Unlimited" when
 *     the limit is `null` (R8.2, R8.3), via the pure `formatUsage` helper;
 *   - a per-resource upgrade prompt for exactly the resources at/over their
 *     numeric limit (R8.4), via the pure `atLimitResources` selector;
 *   - an error indication with NO usage values when the query fails (R8.6),
 *     plus an explicit loading state — handled by `<DataRegion>`.
 *
 * The upgrade prompts (and a header "Change plan" action) open the OWNER-only
 * `PlanChangeDialog` — the entry point to the manual plan-change action (R8.4).
 * The API remains the enforcement boundary; this view only mirrors it.
 *
 * The active `orgId` comes from the in-memory Auth_Store (`organization.id`).
 */
import { useState, type ReactElement } from "react";
import type {
	PlanUsageResource,
	PlanUsageResponse,
} from "@queuenow/shared-types";

import { DataRegion } from "@/components/DataRegion";
import { Button } from "@/components/ui/button";
import { useAuthStore, useHasCapability } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { usePlanUsage } from "../api/usePlanUsage";
import { atLimitResources, formatUsage } from "../lib/format-usage";
import { PlanChangeDialog } from "./PlanChangeDialog";

export function PlanUsageView(): ReactElement {
	const copy = strings.plan;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const usageQuery = usePlanUsage({
		orgId: orgId ?? "",
		enabled: orgId !== null,
	});

	if (orgId === null) {
		return (
			<main className="mx-auto max-w-3xl p-8">
				<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
				<p className="mt-2 text-muted-foreground">{copy.noOrganization}</p>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-3xl space-y-8 p-8">
			<header className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
				<p className="text-muted-foreground">{copy.subtitle}</p>
			</header>

			<DataRegion
				isLoading={usageQuery.isLoading}
				isError={usageQuery.isError}
				error={usageQuery.error}
				data={usageQuery.data}
				errorMessage={getErrorMessage(usageQuery.error) || copy.loadError}
				onRetry={() => void usageQuery.refetch()}
			>
				{(usage) => <PlanUsageContent orgId={orgId} usage={usage} />}
			</DataRegion>
		</main>
	);
}

/** Props for the loaded plan-usage content. */
interface PlanUsageContentProps {
	/** The organization whose plan/usage is shown. */
	orgId: string;
	/** The loaded plan-usage projection. */
	usage: PlanUsageResponse;
}

/**
 * Rendered once the plan-usage projection has loaded. Kept separate so the
 * `<DataRegion>` success branch receives the non-null projection and so the
 * dialog open-state lives alongside the resources that drive it.
 */
function PlanUsageContent({
	orgId,
	usage,
}: PlanUsageContentProps): ReactElement {
	const copy = strings.plan;
	const canManageBilling = useHasCapability("manage-billing");
	const [dialogOpen, setDialogOpen] = useState(false);

	// Property 11 selector: the exact set of resources to show a prompt for.
	const atLimit = new Set(
		atLimitResources(usage).map((resource) => resource.resource),
	);
	const planName = copy.planNames[usage.plan];

	return (
		<section className="space-y-6">
			<div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
				<div className="space-y-0.5">
					<p className="text-sm text-muted-foreground">
						{copy.currentPlanLabel}
					</p>
					<p className="text-xl font-semibold tracking-tight">{planName}</p>
				</div>
				{canManageBilling ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => setDialogOpen(true)}
					>
						{copy.changeDialog.trigger}
					</Button>
				) : null}
			</div>

			<div className="space-y-3">
				<h2 className="text-sm font-medium text-muted-foreground">
					{copy.usageHeading}
				</h2>
				<ul className="divide-y divide-border rounded-lg border border-border">
					{usage.resources.map((resource) => (
						<PlanUsageRow
							key={resource.resource}
							resource={resource}
							isAtLimit={atLimit.has(resource.resource)}
							canManageBilling={canManageBilling}
							onUpgrade={() => setDialogOpen(true)}
						/>
					))}
				</ul>
			</div>

			<PlanChangeDialog
				orgId={orgId}
				currentPlan={usage.plan}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
		</section>
	);
}

/** Props for a single resource usage row. */
interface PlanUsageRowProps {
	/** The resource usage projection for this row. */
	resource: PlanUsageResource;
	/** Whether this resource is at/over its numeric limit (R8.4). */
	isAtLimit: boolean;
	/** Whether the active role may open the plan-change dialog (OWNER-only). */
	canManageBilling: boolean;
	/** Opens the plan-change dialog (the upgrade entry point). */
	onUpgrade: () => void;
}

/** A single "{resource}: {usage} / {limit}" row with an optional upgrade prompt. */
function PlanUsageRow({
	resource,
	isAtLimit,
	canManageBilling,
	onUpgrade,
}: PlanUsageRowProps): ReactElement {
	const copy = strings.plan;
	const resourceLabel = copy.resources[resource.resource];

	return (
		<li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-center justify-between gap-4 sm:flex-1">
				<span className="font-medium">{resourceLabel}</span>
				<span className="tabular-nums text-muted-foreground">
					{formatUsage(resource.usage, resource.limit, copy.unlimited)}
				</span>
			</div>

			{isAtLimit ? (
				<div
					role="alert"
					className="flex flex-col items-start gap-2 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center"
				>
					<span>
						{copy.atLimit.message.replace("{resource}", resourceLabel)}
					</span>
					{canManageBilling ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={onUpgrade}
						>
							{copy.atLimit.action}
						</Button>
					) : null}
				</div>
			) : null}
		</li>
	);
}
