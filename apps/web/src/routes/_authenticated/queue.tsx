import { createFileRoute } from "@tanstack/react-router";

import { QueueStatusView } from "@/features/queue";

/**
 * Staff queue-serving panel route. Thin per steering "routes stay thin": it just
 * mounts the feature component, which reads the active org from the Auth_Store.
 * Queue serving is permitted for OWNER/ADMIN/STAFF, so the `_authenticated`
 * layout guard is sufficient — no extra role guard here.
 */
export const Route = createFileRoute("/_authenticated/queue")({
	component: QueueRouteComponent,
});

function QueueRouteComponent() {
	return <QueueStatusView />;
}
