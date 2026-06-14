/*
 * DashboardHome — the authenticated dashboard landing surface.
 *
 * Replaces the earlier scaffold with a today-at-a-glance summary: per-status
 * ticket counts from `useOrgStats` (GET /organizations/:id/stats), rendered
 * through the shared `<DataRegion>` and refreshed on an interval. A shortcut
 * links to the live queue panel.
 *
 * Read-only and self-contained; the route already gates this to authenticated
 * users via the `_authenticated` layout guard.
 */
import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	Hourglass,
	ListChecks,
	SkipForward,
	Users,
	type LucideIcon,
} from "lucide-react";

import { DataRegion } from "@/components/DataRegion";
import { useAuthStore } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { useOrgStats } from "../api/useOrgStats";
import type { OrgStats } from "../types";

/** Replace `{key}` placeholders in a template. */
function interpolate(
	template: string,
	values: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (_m, key: string) =>
		key in values ? String(values[key]) : `{${key}}`,
	);
}

/** A single summary stat card. */
function StatCard({
	label,
	value,
	icon: Icon,
	accent,
}: {
	label: string;
	value: number;
	icon: LucideIcon;
	accent: string;
}): ReactElement {
	return (
		<div className="flex items-center gap-4 rounded-xl border border-border bg-card p-5">
			<span
				className={cn(
					"flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
					accent,
				)}
			>
				<Icon className="h-6 w-6" aria-hidden="true" />
			</span>
			<div className="flex flex-col">
				<span className="text-3xl font-semibold tabular-nums leading-none">
					{value}
				</span>
				<span className="mt-1 text-sm text-muted-foreground">{label}</span>
			</div>
		</div>
	);
}

/** The dashboard home view. */
export function DashboardHome(): ReactElement {
	const copy = strings.dashboard;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);
	const userName = useAuthStore((state) => state.user?.fullName ?? null);

	const hasOrg = Boolean(orgId);
	const statsQuery = useOrgStats({ orgId: orgId ?? "", enabled: hasOrg });

	if (!hasOrg) {
		return (
			<main className="mx-auto max-w-5xl p-8">
				<p className="text-sm text-muted-foreground">{copy.noOrganization}</p>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-5xl space-y-6 p-8">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{copy.title}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{userName
							? interpolate(copy.greeting, { name: userName })
							: copy.subtitle}
					</p>
				</div>
				<Link
					to="/queue"
					className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					{copy.goToQueue}
				</Link>
			</header>

			<DataRegion<OrgStats>
				isLoading={statsQuery.isLoading}
				isError={statsQuery.isError}
				error={statsQuery.error}
				data={statsQuery.data}
				errorMessage={getErrorMessage(statsQuery.error) || copy.loadError}
				onRetry={() => {
					void statsQuery.refetch();
				}}
				loadingLabel={copy.title}
			>
				{(stats) => (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<StatCard
							label={copy.stats.waiting}
							value={stats.waiting}
							icon={Hourglass}
							accent="bg-amber-500/10 text-amber-600"
						/>
						<StatCard
							label={copy.stats.serving}
							value={stats.serving}
							icon={Users}
							accent="bg-primary/10 text-primary"
						/>
						<StatCard
							label={copy.stats.completed}
							value={stats.completed}
							icon={CheckCircle2}
							accent="bg-emerald-500/10 text-emerald-600"
						/>
						<StatCard
							label={copy.stats.skipped}
							value={stats.skipped}
							icon={SkipForward}
							accent="bg-muted text-muted-foreground"
						/>
						<StatCard
							label={copy.stats.total}
							value={stats.total}
							icon={ListChecks}
							accent="bg-secondary text-secondary-foreground"
						/>
					</div>
				)}
			</DataRegion>
		</main>
	);
}
