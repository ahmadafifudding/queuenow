import { createFileRoute } from "@tanstack/react-router";

import { KioskScreen } from "@/features/kiosk";

/**
 * Public Kiosk ticket-taking flow at /kiosk/:orgId. Code-split out of the
 * Dashboard bundle via autoCodeSplitting (Req 1.8). The route stays thin: it
 * parses the `orgId` param and renders the feature screen, which owns the
 * select → details → ticket flow (R12).
 */
export const Route = createFileRoute("/kiosk/$orgId")({
	component: KioskRoute,
});

function KioskRoute() {
	const { orgId } = Route.useParams();
	return <KioskScreen orgId={orgId} />;
}
