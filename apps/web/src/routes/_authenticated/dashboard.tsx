import { createFileRoute } from "@tanstack/react-router";

import { DashboardHome } from "@/features/dashboard";

/** Dashboard home — today's queue summary. */
export const Route = createFileRoute("/_authenticated/dashboard")({
	component: DashboardHome,
});
