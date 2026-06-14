/*
 * TicketTracker — the public, phone-facing ticket-tracking screen (R12.5).
 *
 * Opened by scanning the kiosk QR (`/track/:orgId/:ticketId`). It is fully
 * unauthenticated and read-only: it polls the public ticket-status endpoint via
 * `useTicketStatus` and presents the ticket number, live status, position, and
 * estimated wait. The called/serving/skipped states are conveyed with text +
 * icon (not color alone) for accessibility (R13.3), with large, mobile-friendly
 * typography.
 */
import type { ReactElement } from "react";
import {
	BellRing,
	CheckCircle2,
	Clock,
	Hourglass,
	XCircle,
	type LucideIcon,
} from "lucide-react";
import { TicketStatus } from "@queuenow/shared-types";

import { DataRegion } from "@/components/DataRegion";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { useTicketStatus } from "../api/useTicketStatus";
import type { TrackedTicket } from "../types";

/** Props for {@link TicketTracker}. */
export interface TicketTrackerProps {
	/** The organization the ticket belongs to (from the route param). */
	orgId: string;
	/** The ticket id to track (from the route param). */
	ticketId: string;
}

/** Replace `{key}` placeholders in a template with the given values. */
function interpolate(
	template: string,
	values: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
		key in values ? String(values[key]) : `{${key}}`,
	);
}

/** Resolved presentation for a ticket status. */
interface StatusPresentation {
	headline: string;
	detail: string;
	icon: LucideIcon;
	/** Tailwind classes for the status accent (paired with text + icon). */
	accent: string;
}

/** Map a ticket to its headline/detail/icon/accent (text + icon, not color alone). */
function presentationFor(ticket: TrackedTicket): StatusPresentation {
	const copy = strings.tracking.status;
	const counterName = ticket.counter?.name;

	switch (ticket.status) {
		case TicketStatus.CALLED:
			return {
				headline: copy.calledHeadline,
				detail: counterName
					? interpolate(copy.calledDetail, { counter: counterName })
					: copy.calledDetailNoCounter,
				icon: BellRing,
				accent: "border-primary bg-primary/10 text-primary",
			};
		case TicketStatus.SERVING:
			return {
				headline: copy.servingHeadline,
				detail: counterName
					? interpolate(copy.servingDetail, { counter: counterName })
					: copy.servingDetailNoCounter,
				icon: BellRing,
				accent: "border-primary bg-primary/10 text-primary",
			};
		case TicketStatus.COMPLETED:
			return {
				headline: copy.completedHeadline,
				detail: copy.completedDetail,
				icon: CheckCircle2,
				accent: "border-emerald-500 bg-emerald-500/10 text-emerald-600",
			};
		case TicketStatus.SKIPPED:
			return {
				headline: copy.skippedHeadline,
				detail: copy.skippedDetail,
				icon: XCircle,
				accent: "border-destructive bg-destructive/10 text-destructive",
			};
		case TicketStatus.WAITING:
		default:
			return {
				headline: copy.waitingHeadline,
				detail:
					ticket.position !== null
						? interpolate(copy.waitingDetail, { position: ticket.position })
						: copy.waitingDetailNoPosition,
				icon: Hourglass,
				accent: "border-amber-500 bg-amber-500/10 text-amber-600",
			};
	}
}

/** A labelled stat shown beneath the status (position / estimated wait). */
function Stat({
	label,
	value,
}: {
	label: string;
	value: string;
}): ReactElement {
	return (
		<div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-3">
			<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="text-2xl font-semibold tabular-nums">{value}</span>
		</div>
	);
}

/** Render the loaded ticket. */
function TicketCard({ ticket }: { ticket: TrackedTicket }): ReactElement {
	const copy = strings.tracking;
	const presentation = presentationFor(ticket);
	const Icon = presentation.icon;
	const isWaiting = ticket.status === TicketStatus.WAITING;

	return (
		<div className="flex w-full max-w-md flex-col items-center gap-6">
			{/* Ticket number — the hero element. */}
			<div className="flex w-full flex-col items-center gap-1 rounded-3xl border-2 border-border bg-card p-8 text-center">
				<span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
					{copy.yourNumberLabel}
				</span>
				<span className="font-mono text-6xl font-black leading-none tracking-tight sm:text-7xl">
					{ticket.ticketNumber}
				</span>
				<span className="mt-1 text-sm text-muted-foreground">
					{copy.serviceLabel}: {ticket.service.name}
				</span>
			</div>

			{/* Status — text + icon, never color alone (R13.3). */}
			<div
				className={cn(
					"flex w-full flex-col items-center gap-2 rounded-2xl border-2 p-6 text-center",
					presentation.accent,
				)}
			>
				<Icon className="h-8 w-8" aria-hidden="true" />
				<span className="text-2xl font-bold">{presentation.headline}</span>
				<span className="text-base font-medium text-foreground">
					{presentation.detail}
				</span>
			</div>

			{/* Live stats while waiting. */}
			{isWaiting ? (
				<div className="grid w-full grid-cols-2 gap-3">
					{ticket.position !== null ? (
						<Stat label={copy.positionLabel} value={`#${ticket.position}`} />
					) : null}
					{ticket.estimatedWaitMinutes !== null ? (
						<Stat
							label={copy.estimatedWaitLabel}
							value={`${ticket.estimatedWaitMinutes} ${copy.minutesSuffix}`}
						/>
					) : null}
				</div>
			) : null}

			{ticket.recallCount > 0 ? (
				<p className="text-sm text-muted-foreground">
					{interpolate(copy.recallNote, { count: ticket.recallCount })}
				</p>
			) : null}

			<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Clock className="h-3.5 w-3.5" aria-hidden="true" />
				{copy.autoRefreshNote}
			</p>
		</div>
	);
}

/**
 * The public ticket-tracking screen.
 *
 * @param props - the org + ticket ids from the route.
 */
export function TicketTracker({
	orgId,
	ticketId,
}: TicketTrackerProps): ReactElement {
	const copy = strings.tracking;
	const query = useTicketStatus({ orgId, ticketId });

	return (
		<main className="flex min-h-screen flex-col items-center bg-background px-4 py-10 text-foreground">
			<h1 className="mb-8 text-xl font-semibold tracking-tight text-muted-foreground">
				{copy.title}
			</h1>

			<DataRegion<TrackedTicket>
				isLoading={query.isLoading}
				isError={query.isError}
				error={query.error}
				data={query.data}
				errorMessage={getErrorMessage(query.error) || copy.loadError}
				onRetry={() => {
					void query.refetch();
				}}
				loadingLabel={copy.title}
				className="flex w-full justify-center"
			>
				{(ticket) => <TicketCard ticket={ticket} />}
			</DataRegion>
		</main>
	);
}
