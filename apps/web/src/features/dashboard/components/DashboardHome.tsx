/*
 * DashboardHome — the authenticated dashboard landing surface.
 *
 * A today-at-a-glance summary: headline stat cards from `useOrgStats`, a live
 * "now calling" strip and a per-service breakdown from `useQueueOverview`, each
 * rendered through the shared `<Card>` + `<DataRegion>` and refreshed on an
 * interval. A shortcut links to the live queue panel.
 *
 * Read-only and self-contained; the route already gates this to authenticated
 * users via the `_authenticated` layout guard.
 */
import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import {
	BellRing,
	CheckCircle2,
	Hourglass,
	ListChecks,
	SkipForward,
	Users,
	type LucideIcon,
} from "lucide-react";

import { DataRegion } from "@/components/DataRegion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { useOrgStats } from "../api/useOrgStats";
import { useQueueOverview } from "../api/useQueueOverview";
import type { OrgStats, OverviewServiceStatus, QueueOverview } from "../types";

/** Replace `{key}` placeholders in a template. */
function interpolate(template: string, values: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (_m, key: string) =>
		key in values ? String(values[key]) : `{${key}}`,
	);
}

/** A single headline stat card. */
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
		<Card>
			<CardContent className="flex items-center gap-4 p-5">
				<span
					className={cn(
						"flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
						accent,
					)}
				>
					<Icon className="h-6 w-6" aria-hidden="true" />
				</span>
				<div className="flex flex-col">
					<span className="text-3xl font-semibold leading-none tabular-nums">{value}</span>
					<span className="mt-1 text-sm text-muted-foreground">{label}</span>
				</div>
			</CardContent>
		</Card>
	);
}

/** Flatten every service's currently-called tickets into one list. */
function flattenCalled(
	overview: QueueOverview | undefined,
): { key: string; ticketNumber: string; serviceName: string; counterName?: string }[] {
	if (!overview) {
		return [];
	}
	return overview.services.flatMap((s) =>
		s.currentlyCalled.map((t) => ({
			key: `${s.service.id}:${t.ticketNumber}`,
			ticketNumber: t.ticketNumber,
			serviceName: s.service.name,
			counterName: t.counterName,
		})),
	);
}

/** A row in the per-service breakdown. */
function ServiceRow({ status }: { status: OverviewServiceStatus }): ReactElement {
	const copy = strings.dashboard;
	return (
		<li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
			<div className="min-w-0">
				<p className="truncate font-medium">{status.service.name}</p>
				<p className="text-xs uppercase tracking-wide text-muted-foreground">
					{status.service.prefix}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-4 text-sm tabular-nums">
				<span className="text-amber-600">
					{status.waiting} <span className="text-muted-foreground">{copy.perServiceWaiting}</span>
				</span>
				<span className="text-primary">
					{status.serving} <span className="text-muted-foreground">{copy.perServiceServing}</span>
				</span>
				<span className="text-emerald-600">
					{status.completedToday}{" "}
					<span className="text-muted-foreground">{copy.perServiceCompleted}</span>
				</span>
			</div>
		</li>
	);
}

/** The dashboard home view. */
export function DashboardHome(): ReactElement {
	const copy = strings.dashboard;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);
	const userName = useAuthStore((state) => state.user?.fullName ?? null);

	const hasOrg = Boolean(orgId);
	const safeOrgId = orgId ?? "";
	const statsQuery = useOrgStats({ orgId: safeOrgId, enabled: hasOrg });
	const overviewQuery = useQueueOverview({ orgId: safeOrgId, enabled: hasOrg });

	if (!hasOrg) {
		return (
			<main className="mx-auto max-w-6xl p-8">
				<p className="text-sm text-muted-foreground">{copy.noOrganization}</p>
			</main>
		);
	}

	const called = flattenCalled(overviewQuery.data);

	return (
		<main className="mx-auto max-w-6xl space-y-8 p-8">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{userName ? interpolate(copy.greeting, { name: userName }) : copy.subtitle}
					</p>
				</div>
				<Link
					to="/queue"
					className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					{copy.goToQueue}
				</Link>
			</header>

			{/* Headline stats */}
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

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* Now calling */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
							{copy.nowCallingTitle}
						</CardTitle>
					</CardHeader>
					<CardContent>
						{called.length > 0 ? (
							<ul className="flex flex-wrap gap-2">
								{called.map((t) => (
									<li
										key={t.key}
										className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5"
									>
										<span className="font-mono text-base font-semibold">{t.ticketNumber}</span>
										<span className="text-sm text-muted-foreground">
											{t.counterName ?? t.serviceName}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-muted-foreground">{copy.nowCallingEmpty}</p>
						)}
					</CardContent>
				</Card>

				{/* Per-service breakdown */}
				<Card>
					<CardHeader>
						<CardTitle>{copy.byServiceTitle}</CardTitle>
					</CardHeader>
					<CardContent>
						{overviewQuery.data && overviewQuery.data.services.length > 0 ? (
							<ul className="-my-3">
								{overviewQuery.data.services.map((status) => (
									<ServiceRow key={status.service.id} status={status} />
								))}
							</ul>
						) : (
							<p className="text-sm text-muted-foreground">{copy.byServiceEmpty}</p>
						)}
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
