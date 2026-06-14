/*
 * ServingActions — the staff queue-serving controls (R6.3–R6.11).
 *
 * Owns all five serving mutation hooks (call next / recall / skip / complete /
 * rejoin) and the small amount of ephemeral UI state that ties them together:
 *
 *  - `servingTicket` — the ticket this staff member is currently working, set
 *    from the call-next result (R6.3) and refreshed by recall (R6.5). Recall /
 *    skip / complete act on THIS ticket. The aggregate queue-status payload only
 *    exposes ticket NUMBERS (not ids), so the concrete ticket a staff member
 *    serves is tracked here from the mutation result — exactly as anticipated by
 *    the task 8.1 type note.
 *  - `lastSkipped` — the most recently skipped ticket, surfaced so it can be
 *    rejoined back into WAITING (R6.9).
 *
 * Each hook already applies the optimistic snapshot+patch, rolls back on failure
 * with a code-mapped toast (incl. QUEUE_NO_WAITING / QUEUE_MAX_RECALL), and
 * invalidates the queue key so the server result + the `queue:update` socket
 * event reconcile (R6.10, R6.11, R6.12). This component layers the per-action
 * local state via per-call `onSuccess` callbacks, leaving that shared lifecycle
 * untouched.
 */
import { useState, type ReactElement } from "react";
import type { ICounter, IQueueTicket } from "@queuenow/shared-types";

import { Button } from "@/components/ui/button";
import { strings } from "@/i18n";

import { useCallNextTicket } from "../api/useCallNextTicket";
import { useCompleteTicket } from "../api/useCompleteTicket";
import { useRecallTicket } from "../api/useRecallTicket";
import { useRejoinTicket } from "../api/useRejoinTicket";
import { useSkipTicket } from "../api/useSkipTicket";

/** Props for {@link ServingActions}. */
export interface ServingActionsProps {
	/** The organization the queue belongs to. */
	orgId: string;
	/**
	 * The serviceId the panel's queue-status query is scoped to. Selects the
	 * cache key the optimistic patches and invalidations operate on.
	 */
	scopeServiceId?: string;
	/** The counter the staff member is serving from, or `null` if none chosen. */
	selectedCounter: ICounter | null;
}

/**
 * Render the call-next control plus, once a ticket is being served, the recall /
 * skip / complete controls, and a rejoin affordance for the last skipped ticket.
 */
export function ServingActions({
	orgId,
	scopeServiceId,
	selectedCounter,
}: ServingActionsProps): ReactElement {
	const copy = strings.queue;

	// The ticket currently being served at this counter and the last one skipped.
	const [servingTicket, setServingTicket] = useState<IQueueTicket | null>(null);
	const [lastSkipped, setLastSkipped] = useState<IQueueTicket | null>(null);

	const callNext = useCallNextTicket({ orgId, scopeServiceId });
	const recall = useRecallTicket({ orgId, scopeServiceId });
	const skip = useSkipTicket({ orgId, scopeServiceId });
	const complete = useCompleteTicket({ orgId, scopeServiceId });
	const rejoin = useRejoinTicket({ orgId, scopeServiceId });

	const canCallNext = Boolean(selectedCounter) && !callNext.isPending;

	const handleCallNext = (): void => {
		if (!selectedCounter) {
			return;
		}
		callNext.mutate(
			{ counterId: selectedCounter.id, serviceId: selectedCounter.serviceId },
			{ onSuccess: (ticket) => setServingTicket(ticket) },
		);
	};

	const handleRecall = (): void => {
		if (!servingTicket) {
			return;
		}
		recall.mutate(
			{ ticketId: servingTicket.id, serviceId: servingTicket.serviceId },
			// Refresh the working ticket so the updated recall count is reflected.
			{ onSuccess: (ticket) => setServingTicket(ticket) },
		);
	};

	const handleSkip = (): void => {
		if (!servingTicket) {
			return;
		}
		skip.mutate(
			{
				ticketId: servingTicket.id,
				serviceId: servingTicket.serviceId,
				ticketNumber: servingTicket.ticketNumber,
			},
			{
				onSuccess: (ticket) => {
					setServingTicket(null);
					setLastSkipped(ticket);
				},
			},
		);
	};

	const handleComplete = (): void => {
		if (!servingTicket) {
			return;
		}
		complete.mutate(
			{
				ticketId: servingTicket.id,
				serviceId: servingTicket.serviceId,
				ticketNumber: servingTicket.ticketNumber,
			},
			{ onSuccess: () => setServingTicket(null) },
		);
	};

	const handleRejoin = (): void => {
		if (!lastSkipped) {
			return;
		}
		rejoin.mutate(
			{ ticketId: lastSkipped.id, serviceId: lastSkipped.serviceId },
			{ onSuccess: () => setLastSkipped(null) },
		);
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Call next (R6.3, R6.4 surfaces via the hook's error toast). */}
			<div>
				<Button
					type="button"
					onClick={handleCallNext}
					disabled={!canCallNext}
					className="w-full"
				>
					{callNext.isPending
						? copy.actions.callNextPending
						: copy.actions.callNext}
				</Button>
				{!selectedCounter ? (
					<p className="mt-1 text-xs text-muted-foreground">
						{copy.actions.selectCounterFirst}
					</p>
				) : null}
			</div>

			{/* Active serving ticket + recall / skip / complete (R6.5, R6.7, R6.8). */}
			<section
				aria-label={copy.nowServingTitle}
				className="rounded-lg border border-border p-4"
			>
				<h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{copy.nowServingTitle}
				</h2>

				{servingTicket ? (
					<>
						<div className="mt-2 flex items-baseline gap-3">
							<span className="text-3xl font-semibold tabular-nums">
								{servingTicket.ticketNumber}
							</span>
							<span className="text-sm text-muted-foreground">
								{copy.recallsLabel}: {servingTicket.recallCount}
							</span>
						</div>

						<div className="mt-3 flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={handleRecall}
								disabled={recall.isPending}
							>
								{recall.isPending
									? copy.actions.recallPending
									: copy.actions.recall}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={handleSkip}
								disabled={skip.isPending}
							>
								{skip.isPending ? copy.actions.skipPending : copy.actions.skip}
							</Button>
							<Button
								type="button"
								onClick={handleComplete}
								disabled={complete.isPending}
							>
								{complete.isPending
									? copy.actions.completePending
									: copy.actions.complete}
							</Button>
						</div>
					</>
				) : (
					<p className="mt-2 text-sm text-muted-foreground">
						{copy.nowServingEmpty}
					</p>
				)}
			</section>

			{/* Rejoin the most recently skipped ticket back into WAITING (R6.9). */}
			{lastSkipped ? (
				<section
					aria-label={copy.recentlySkippedTitle}
					className="rounded-lg border border-dashed border-border p-4"
				>
					<h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{copy.recentlySkippedTitle}
					</h2>
					<div className="mt-2 flex items-center justify-between gap-3">
						<span className="text-xl font-semibold tabular-nums">
							{lastSkipped.ticketNumber}
						</span>
						<Button
							type="button"
							variant="outline"
							onClick={handleRejoin}
							disabled={rejoin.isPending}
						>
							{rejoin.isPending
								? copy.actions.rejoinPending
								: copy.actions.rejoin}
						</Button>
					</div>
				</section>
			) : null}
		</div>
	);
}
