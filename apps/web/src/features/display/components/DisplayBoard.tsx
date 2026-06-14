/*
 * DisplayBoard — the public, read-only "now serving" board (R7.1, R7.2).
 *
 * Rendered by the lazy `/display/:orgId` route (code-split out of the dashboard
 * bundle, R1.8). It is fully unauthenticated and performs no mutations:
 *
 * - Reads queue status via `useDisplayQueue` (public `@Public()` endpoint) on
 *   the central `queryKeys.queue(orgId)` key (R7.1, R7.2).
 * - Subscribes to the org room over a PUBLIC, token-less socket connection via
 *   `useSocketSubscription({ mode: 'public' })`; the socket bridge invalidates
 *   that same query key on `queue:ticket-called`, so the board updates live
 *   (R7.3) with no bespoke event handling here.
 * - Falls back to REST polling while realtime is down via `usePollingFallback`,
 *   and surfaces a non-blocking reconnecting banner via `<ConnectionIndicator>`
 *   (R7.9). The always-on board keeps refreshing through outages.
 * - Supports whole-page fullscreen for unattended TV operation via
 *   `useFullscreen` (R7.8); after entering fullscreen the board needs no further
 *   interaction.
 * - Formats the "last updated" time in the Org_Timezone via `lib/format.ts`
 *   (R7.10); the timezone is resolved from the `?tz=` param (see
 *   `resolveTimeZone`).
 *
 * Task 9.2 layers on the accessible audio + presentation:
 * - `useAnnouncer` diffs the called set between renders and plays a chime then
 *   speaks each newly-called ticket (chime-only fallback) (R7.4).
 * - A mute control silences announcements and persists the choice (R7.5).
 * - A one-time `<SoundUnlockOverlay>` satisfies the browser audio-unlock gesture
 *   on first load and is not shown again once unlocked (R7.6).
 * - The called state is conveyed with text + icon ("Now calling"), not color
 *   alone, with large high-contrast typography (R7.7, R13.3).
 */
import { useMemo, useState, type ReactElement } from "react";
import { BellRing, Maximize, Minimize, Volume2, VolumeX } from "lucide-react";

import { DataRegion } from "@/components/DataRegion";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { Button } from "@/components/ui/button";
import { useSocketSubscription } from "@/hooks/useSocketSubscription";
import { usePollingFallback } from "@/hooks/usePollingFallback";
import { formatTimeInZone } from "@/lib/format";
import { strings } from "@/i18n";

import { useDisplayQueue } from "../api/useDisplayQueue";
import { useFullscreen } from "../hooks/useFullscreen";
import { useAnnouncer } from "../hooks/useAnnouncer";
import { useMutePreference } from "../hooks/useMutePreference";
import { SoundUnlockOverlay } from "./SoundUnlockOverlay";
import { resolveTimeZone } from "../lib/resolve-timezone";
import type { DisplayCalledEntry, DisplayQueueStatus } from "../types";

/** Props for {@link DisplayBoard}. */
export interface DisplayBoardProps {
	/** The organization whose queue to display (from the route `orgId` param). */
	orgId: string;
	/**
	 * Optional IANA timezone from the route `?tz=` search param. Used to pin the
	 * Org_Timezone for an unattended screen; see {@link resolveTimeZone}.
	 */
	timeZoneParam?: string;
}

/**
 * Flatten each service's currently-called tickets into a single render list,
 * pairing every called ticket number with its service name (R7.2). Order is
 * preserved (newest-called first within a service, services in payload order).
 */
function flattenCalled(
	status: DisplayQueueStatus | undefined,
): DisplayCalledEntry[] {
	if (!status) {
		return [];
	}
	return status.services.flatMap((service) =>
		service.currentlyCalled.map((ticket) => ({
			...ticket,
			key: `${service.service.id}::${ticket.ticketNumber}`,
			serviceName: service.service.name,
		})),
	);
}

/** Format an ISO timestamp in the org timezone, returning `null` if unparseable. */
function safeFormatTime(value: string, timeZone: string): string | null {
	try {
		return formatTimeInZone(value, timeZone);
	} catch {
		return null;
	}
}

/** A single called-ticket tile: large ticket number plus its service + counter. */
function CalledTicketTile({
	entry,
}: {
	entry: DisplayCalledEntry;
}): ReactElement {
	return (
		<li className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-amber-300 bg-slate-800 p-6 text-center shadow-lg sm:p-8">
			{/*
			 * Called-state indicator conveyed with TEXT + ICON, not color alone
			 * (R7.7, R13.3): every tile on this board is a currently-called ticket,
			 * so each is explicitly labelled "Now calling" with a bell icon.
			 */}
			<span className="flex items-center gap-2 rounded-full bg-amber-300 px-4 py-1 text-sm font-bold uppercase tracking-widest text-slate-950 sm:text-base">
				<BellRing className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
				{strings.display.nowCalling}
			</span>
			<span className="text-base font-semibold uppercase tracking-widest text-slate-300 sm:text-lg">
				{entry.serviceName}
			</span>
			<span className="font-mono text-6xl font-black leading-none tracking-tight text-white sm:text-7xl lg:text-8xl">
				{entry.ticketNumber}
			</span>
			<span className="flex flex-col items-center gap-0.5">
				<span className="text-sm font-medium uppercase tracking-wide text-slate-300 sm:text-base">
					{strings.display.counterLabel}
				</span>
				<span className="text-2xl font-bold text-amber-200 sm:text-3xl">
					{entry.counterName ?? strings.display.counterUnassigned}
				</span>
			</span>
		</li>
	);
}

/**
 * The public Display (TV) board.
 *
 * @param props - the org id and optional `?tz=` timezone param.
 */
export function DisplayBoard({
	orgId,
	timeZoneParam,
}: DisplayBoardProps): ReactElement {
	const timeZone = resolveTimeZone(timeZoneParam);

	// Public, token-less realtime subscription + REST polling fallback. Both push
	// updates into the `queryKeys.queue(orgId)` cache this board reads (R7.3, R7.9).
	useSocketSubscription({ orgId, mode: "public" });
	usePollingFallback({ orgId });

	const query = useDisplayQueue({ orgId });
	const {
		isFullscreen,
		isSupported: fullscreenSupported,
		toggle,
	} = useFullscreen();

	const calledEntries = useMemo(() => flattenCalled(query.data), [query.data]);
	const lastUpdatedLabel = query.data
		? safeFormatTime(query.data.lastUpdated, timeZone)
		: null;
	const heading = query.data?.organizationName ?? strings.display.title;

	// Audio: mute preference + the announcer that diffs the called set and
	// chimes/announces newly-called tickets (R7.4, R7.5). Announcements only
	// fire once sound is unlocked by the one-time overlay gesture (R7.6).
	const { muted, toggleMuted } = useMutePreference();
	const [soundUnlocked, setSoundUnlocked] = useState<boolean>(false);
	const { unlock, canAnnounce } = useAnnouncer({
		entries: calledEntries,
		enabled: soundUnlocked,
		muted,
	});

	// Only surface audio chrome where the host can actually produce sound. The
	// overlay shows once, until unlocked.
	const showSoundOverlay = canAnnounce && !soundUnlocked;

	const handleEnableSound = (): void => {
		unlock();
		setSoundUnlocked(true);
	};

	return (
		<div className="relative flex min-h-screen flex-col bg-slate-950 text-white">
			{/* Non-blocking reconnecting banner while realtime is down (R7.9, R3.11). */}
			<ConnectionIndicator />

			<header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-5 sm:px-10">
				<div className="flex flex-col">
					<span className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-300 sm:text-base">
						{strings.display.title}
					</span>
					<h1 className="text-2xl font-bold text-white sm:text-4xl">
						{heading}
					</h1>
				</div>
				<div className="flex items-center gap-3">
					{canAnnounce ? (
						<Button
							variant="outline"
							size="lg"
							onClick={toggleMuted}
							aria-pressed={muted}
							aria-label={muted ? strings.display.unmute : strings.display.mute}
							className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
						>
							{muted ? (
								<VolumeX className="h-5 w-5" aria-hidden="true" />
							) : (
								<Volume2 className="h-5 w-5" aria-hidden="true" />
							)}
							<span className="hidden sm:inline">
								{muted ? strings.display.unmute : strings.display.mute}
							</span>
						</Button>
					) : null}
					{fullscreenSupported ? (
						<Button
							variant="outline"
							size="lg"
							onClick={() => {
								void toggle();
							}}
							aria-label={
								isFullscreen
									? strings.display.exitFullscreen
									: strings.display.enterFullscreen
							}
							className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
						>
							{isFullscreen ? (
								<Minimize className="h-5 w-5" aria-hidden="true" />
							) : (
								<Maximize className="h-5 w-5" aria-hidden="true" />
							)}
							<span className="hidden sm:inline">
								{isFullscreen
									? strings.display.exitFullscreen
									: strings.display.enterFullscreen}
							</span>
						</Button>
					) : null}
				</div>
			</header>

			<main className="flex flex-1 flex-col px-6 py-8 sm:px-10">
				<DataRegion<DisplayQueueStatus>
					isLoading={query.isLoading}
					isError={query.isError}
					error={query.error}
					data={query.data}
					isEmpty={calledEntries.length === 0}
					onRetry={() => {
						void query.refetch();
					}}
					renderLoading={() => (
						<output
							className="flex flex-1 items-center justify-center"
							aria-busy="true"
						>
							<span className="text-3xl font-semibold text-slate-400 sm:text-5xl">
								{strings.common.loading}
							</span>
						</output>
					)}
					renderEmpty={() => (
						<output className="flex flex-1 items-center justify-center text-center">
							<span className="text-3xl font-semibold text-slate-400 sm:text-5xl">
								{strings.display.noneCalled}
							</span>
						</output>
					)}
					renderError={(_error, retry) => (
						<div
							role="alert"
							className="flex flex-1 flex-col items-center justify-center gap-6 text-center"
						>
							<span className="text-3xl font-semibold text-red-300 sm:text-5xl">
								{strings.display.loadError}
							</span>
							{retry ? (
								<Button
									variant="outline"
									size="lg"
									onClick={retry}
									className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
								>
									{strings.display.retry}
								</Button>
							) : null}
						</div>
					)}
				>
					{() => (
						<ul className="grid flex-1 auto-rows-min grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{calledEntries.map((entry) => (
								<CalledTicketTile key={entry.key} entry={entry} />
							))}
						</ul>
					)}
				</DataRegion>
			</main>

			<footer className="flex items-center justify-end border-t border-slate-800 px-6 py-3 text-sm text-slate-400 sm:px-10 sm:text-base">
				{lastUpdatedLabel ? (
					<span>
						{strings.display.lastUpdated}: <time>{lastUpdatedLabel}</time>
					</span>
				) : null}
			</footer>

			{/* One-time tap-to-enable-sound gesture overlay (R7.6). */}
			{showSoundOverlay ? (
				<SoundUnlockOverlay onEnable={handleEnableSound} />
			) : null}
		</div>
	);
}
