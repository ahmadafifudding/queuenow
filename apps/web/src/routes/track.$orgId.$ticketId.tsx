import { createFileRoute } from "@tanstack/react-router";

import { TicketTracker } from "@/features/tracking";

/**
 * Public ticket-tracking page at `/track/:orgId/:ticketId` — the destination of
 * the kiosk QR code (R12.5). No authentication; code-split out of the dashboard
 * bundle via autoCodeSplitting (R1.8).
 */
export const Route = createFileRoute("/track/$orgId/$ticketId")({
	component: TrackScreen,
});

function TrackScreen() {
	const { orgId, ticketId } = Route.useParams();
	return <TicketTracker orgId={orgId} ticketId={ticketId} />;
}
