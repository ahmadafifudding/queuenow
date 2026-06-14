/*
 * TicketResult — confirmation screen showing the assigned ticket number plus a
 * QR code linking to the phone-tracking page (R12.4, R12.5).
 *
 * The ticket number is the hero element; the QR encodes the tracking URL built
 * by `buildTrackingUrl` so the customer can follow their place on their phone
 * (MVP is phone-based — no printer). A large "Done" button resets the Kiosk for
 * the next customer (the idle timer does the same automatically, R12.7).
 */
import { useMemo, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { strings } from "@/i18n";

import { buildTrackingUrl } from "../lib/tracking-url";
import type { KioskJoinedTicket } from "../types";
import { TicketQrCode } from "./TicketQrCode";

/** Props for {@link TicketResult}. */
export interface TicketResultProps {
	/** The organization the ticket belongs to (used to build the tracking URL). */
	orgId: string;
	/** The issued ticket. */
	ticket: KioskJoinedTicket;
	/** Reset the Kiosk to the start screen. */
	onDone: () => void;
}

/**
 * The post-join confirmation screen.
 *
 * @param props - the org, issued ticket, and reset callback.
 */
export function TicketResult({
	orgId,
	ticket,
	onDone,
}: TicketResultProps): ReactElement {
	const trackingUrl = useMemo(
		() => buildTrackingUrl(orgId, ticket.id),
		[orgId, ticket.id],
	);

	const hasPosition =
		typeof ticket.position === "number" && ticket.position > 0;
	const hasWait =
		typeof ticket.estimatedWaitMinutes === "number" &&
		ticket.estimatedWaitMinutes > 0;

	return (
		<section
			className="flex w-full max-w-lg flex-col items-center gap-8 text-center"
			aria-labelledby="kiosk-ticket-heading"
		>
			<header>
				<h2
					id="kiosk-ticket-heading"
					className="text-3xl font-bold sm:text-4xl"
				>
					{strings.kiosk.ticketTitle}
				</h2>
			</header>

			<div className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-primary bg-card p-8">
				<span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
					{strings.kiosk.yourNumberLabel}
				</span>
				<span className="font-mono text-7xl font-black leading-none tracking-tight sm:text-8xl">
					{ticket.ticketNumber}
				</span>

				{hasPosition || hasWait ? (
					<dl className="mt-4 flex items-center justify-center gap-8 text-base">
						{hasPosition ? (
							<div className="flex flex-col">
								<dt className="text-muted-foreground">
									{strings.kiosk.positionLabel}
								</dt>
								<dd className="text-2xl font-bold">
									{(ticket.position ?? 1) - 1}
								</dd>
							</div>
						) : null}
						{hasWait ? (
							<div className="flex flex-col">
								<dt className="text-muted-foreground">
									{strings.kiosk.estimatedWaitLabel}
								</dt>
								<dd className="text-2xl font-bold">
									~{ticket.estimatedWaitMinutes} {strings.kiosk.minutesSuffix}
								</dd>
							</div>
						) : null}
					</dl>
				) : null}
			</div>

			<div className="flex flex-col items-center gap-3">
				<TicketQrCode value={trackingUrl} />
				<p className="max-w-xs text-base text-muted-foreground">
					{strings.kiosk.scanToTrack}
				</p>
			</div>

			<Button
				size="lg"
				className="h-14 w-full max-w-xs text-lg"
				onClick={onDone}
			>
				{strings.kiosk.startOver}
			</Button>
		</section>
	);
}
