/*
 * QueueStatusView — the staff queue-serving panel's status surface (R6.1, R6.2,
 * R6.13).
 *
 * Responsibilities for task 8.1:
 * - Read the active org from the Auth_Store and subscribe the panel to that
 *   org's queue room so live `queue:update` events flow into the query cache
 *   (R6.12); a polling fallback keeps the panel fresh if realtime drops (R7.9).
 * - Load the queue status via `useQueueStatus` and render per-service WAITING
 *   counts, currently-called tickets, and the SERVING count through the shared
 *   `<DataRegion>` with explicit loading / empty / error states (R6.1, R6.13).
 * - Offer a counter selector backed by the ephemeral counter-selection store so
 *   a staff member can choose an active counter before serving (R6.2).
 *
 * Serving actions (call next / recall / skip / complete / rejoin) live in the
 * sibling `<ServingActions>` component (task 8.2); this view owns the counter
 * selection and passes the resolved active counter down to it.
 */
import type { ReactElement } from "react";

import { DataRegion } from "@/components/DataRegion";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { useSocketSubscription } from "@/hooks/useSocketSubscription";
import { usePollingFallback } from "@/hooks/usePollingFallback";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useCounters } from "../api/useCounters";
import { useQueueStatus } from "../api/useQueueStatus";
import { useCounterSelectionStore } from "../stores/counter-selection-store";
import type { QueueServiceStatus, QueueStatusResponse } from "../types";
import { CounterSelector } from "./CounterSelector";
import { ServingActions } from "./ServingActions";

/** A single service's queue snapshot card. */
function ServiceCard({ status }: { status: QueueServiceStatus }): ReactElement {
	const copy = strings.queue;
	const {
		service,
		waiting,
		currentlyCalled,
		serving,
		completedToday,
		estimatedWaitMinutes,
	} = status;

	return (
		<article className="rounded-lg border border-border p-4">
			<header className="flex items-baseline justify-between gap-2">
				<h3 className="text-lg font-semibold tracking-tight">{service.name}</h3>
				<span className="text-xs font-medium text-muted-foreground">
					{service.prefix}
				</span>
			</header>

			<dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div>
					<dt className="text-xs text-muted-foreground">{copy.waiting}</dt>
					<dd className="text-2xl font-semibold tabular-nums">{waiting}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">{copy.serving}</dt>
					<dd className="text-2xl font-semibold tabular-nums">{serving}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{copy.completedToday}
					</dt>
					<dd className="text-2xl font-semibold tabular-nums">
						{completedToday}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">
						{copy.estimatedWait}
					</dt>
					<dd className="text-2xl font-semibold tabular-nums">
						{estimatedWaitMinutes}
						<span className="ml-1 text-sm font-normal text-muted-foreground">
							{copy.minutesSuffix}
						</span>
					</dd>
				</div>
			</dl>

			<section className="mt-4">
				<h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{copy.currentlyCalled}
				</h4>
				{currentlyCalled.length > 0 ? (
					<ul className="mt-2 flex flex-wrap gap-2">
						{currentlyCalled.map((ticket) => (
							<li
								key={`${ticket.ticketNumber}-${ticket.counterName ?? "none"}`}
								className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-sm"
							>
								<span className="font-semibold tabular-nums">
									{ticket.ticketNumber}
								</span>
								{ticket.counterName ? (
									<span className="text-muted-foreground">
										{ticket.counterName}
									</span>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="mt-2 text-sm text-muted-foreground">
						{copy.noneCalled}
					</p>
				)}
			</section>
		</article>
	);
}

/** Props for {@link QueueStatusView}. */
export interface QueueStatusViewProps {
	/**
	 * Optional service to scope the panel to a single service. When omitted, the
	 * panel shows every active service for the organization.
	 */
	serviceId?: string;
}

/**
 * The queue-serving panel's read surface: counter selector + live per-service
 * queue status, wired to realtime and a polling fallback.
 */
export function QueueStatusView({
	serviceId,
}: QueueStatusViewProps): ReactElement {
	const copy = strings.queue;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const activeCounterId = useCounterSelectionStore(
		(state) => state.activeCounterId,
	);
	const setActiveCounterId = useCounterSelectionStore(
		(state) => state.setActiveCounterId,
	);

	const hasOrg = Boolean(orgId);
	const safeOrgId = orgId ?? "";

	// Live updates: subscribe the panel to the org/service room (dashboard mode),
	// and fall back to REST polling if the realtime connection drops (R6.12, R7.9).
	useSocketSubscription({
		orgId: safeOrgId,
		serviceId,
		mode: "dashboard",
		enabled: hasOrg,
	});
	usePollingFallback({ orgId: safeOrgId, serviceId, enabled: hasOrg });

	const statusQuery = useQueueStatus({
		orgId: safeOrgId,
		serviceId,
		enabled: hasOrg,
	});
	const countersQuery = useCounters({ orgId: safeOrgId, enabled: hasOrg });

	const activeCounters = (countersQuery.data ?? []).filter(
		(counter) => counter.isActive,
	);

	// The resolved active counter drives every serving action (R6.2, R6.3).
	const selectedCounter =
		activeCounters.find((counter) => counter.id === activeCounterId) ?? null;

	if (!hasOrg) {
		return (
			<section className="mx-auto max-w-5xl p-6">
				<p className="text-sm text-muted-foreground">{copy.noOrganization}</p>
			</section>
		);
	}

	return (
		<section className="mx-auto max-w-5xl p-6">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
			</header>

			<div className="mb-6 max-w-md">
				<CounterSelector
					counters={activeCounters}
					value={activeCounterId}
					onChange={setActiveCounterId}
					disabled={countersQuery.isLoading}
				/>
				{countersQuery.isError ? (
					<p role="alert" className="mt-1 text-sm text-destructive">
						{copy.countersError}
					</p>
				) : null}

				<div className="mt-3">
					<ServingActions
						orgId={safeOrgId}
						scopeServiceId={serviceId}
						selectedCounter={selectedCounter}
					/>
				</div>
			</div>

			<DataRegion<QueueStatusResponse>
				isLoading={statusQuery.isLoading}
				isError={statusQuery.isError}
				error={statusQuery.error}
				data={statusQuery.data}
				isEmpty={(statusQuery.data?.services.length ?? 0) === 0}
				emptyMessage={copy.empty}
				errorMessage={getErrorMessage(statusQuery.error)}
				onRetry={() => {
					void statusQuery.refetch();
				}}
				loadingLabel={copy.title}
			>
				{(data) => (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{data.services.map((serviceStatus) => (
							<ServiceCard
								key={serviceStatus.service.id}
								status={serviceStatus}
							/>
						))}
					</div>
				)}
			</DataRegion>
		</section>
	);
}
