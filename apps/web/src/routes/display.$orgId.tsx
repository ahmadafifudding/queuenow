import { createFileRoute } from "@tanstack/react-router";

import { DisplayBoard } from "@/features/display";

/**
 * Public, read-only Display (TV) board at /display/:orgId. Code-split out of the
 * Dashboard bundle via autoCodeSplitting (Req 1.8). The route stays thin: it
 * parses the `orgId` param plus an optional `tz` search param (used to pin the
 * Org_Timezone for an unattended screen — see features/display/lib/
 * resolve-timezone.ts) and renders the feature board.
 *
 * Audio announcements, the mute control, and the tap-to-enable-sound overlay are
 * added in task 9.2.
 */
export interface DisplaySearch {
	/** Optional IANA timezone to format displayed times in (e.g. `Asia/Kuala_Lumpur`). */
	tz?: string;
}

export const Route = createFileRoute("/display/$orgId")({
	validateSearch: (search: Record<string, unknown>): DisplaySearch => {
		const tz = search.tz;
		return typeof tz === "string" && tz.length > 0 ? { tz } : {};
	},
	component: DisplayScreen,
});

function DisplayScreen() {
	const { orgId } = Route.useParams();
	const { tz } = Route.useSearch();
	return <DisplayBoard orgId={orgId} timeZoneParam={tz} />;
}
