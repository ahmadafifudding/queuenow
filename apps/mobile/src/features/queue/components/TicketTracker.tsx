import { useCallback, useMemo } from "react";
import {
	ActivityIndicator,
	Alert,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { TicketStatus } from "@queuenow/shared-types";

import { strings } from "@/i18n";
import { getErrorMessage } from "@/lib/api/error-map";
import { formatWaitEstimate } from "@/lib/format";
import { reconnectNow, useSocketStatus } from "@/lib/socket";

import type { ProjectedTicketStatus } from "../project-ticket-status";
import { useActiveTicket } from "../use-active-ticket";
import {
	isCancelUnavailableError,
	isInvalidTicketStatusError,
	useCancelTicket,
} from "../use-cancel-ticket";

/** Props for {@link TicketTracker}. The thin route supplies the resolved ids. */
export interface TicketTrackerProps {
	/** The organization the ticket belongs to. */
	orgId: string;
	/** The ticket to track. */
	ticketId: string;
}

/** Resolve the status headline + detail copy for a projected status (R3.1/3.4/3.5). */
function statusCopy(projected: ProjectedTicketStatus): {
	headline: string;
	detail: string;
} {
	const copy = strings.ticket.status;
	switch (projected.status) {
		case TicketStatus.WAITING:
			return {
				headline: copy.waitingHeadline,
				detail:
					projected.position !== null
						? copy.waitingDetail.replace(
								"{position}",
								String(projected.position),
							)
						: copy.waitingDetailNoPosition,
			};
		case TicketStatus.CALLED:
			return {
				headline: copy.calledHeadline,
				detail: projected.counterName
					? copy.calledDetail.replace("{counter}", projected.counterName)
					: copy.calledDetailNoCounter,
			};
		case TicketStatus.SERVING:
			return {
				headline: copy.servingHeadline,
				detail: projected.counterName
					? copy.servingDetail.replace("{counter}", projected.counterName)
					: copy.servingDetailNoCounter,
			};
		case TicketStatus.COMPLETED:
			return { headline: copy.completedHeadline, detail: copy.completedDetail };
		case TicketStatus.SKIPPED:
			return { headline: copy.skippedHeadline, detail: copy.skippedDetail };
		default: {
			// Exhaustiveness guard: a new TicketStatus must be handled above.
			const exhaustive: never = projected.status;
			throw new Error(`Unhandled ticket status: ${String(exhaustive)}`);
		}
	}
}

/**
 * Active-ticket tracking screen (R3, R4, R9).
 *
 * Renders the live ticket status, position, and estimated wait from
 * {@link useActiveTicket}, which owns the REST query (R3.2), the
 * `ticket:update`-driven refetch (R3.3), the realtime subscribe/unsubscribe
 * lifecycle (R4.1/R4.3), turn-alert routing (R5), and the offline cache +
 * connectivity gating (R9). This component is the view: it surfaces the stale
 * indicator while offline (R9.2), a reconnecting indicator + manual-reconnect
 * affordance from the socket status (R4.4/R4.5), and pull-to-refresh (R9.4).
 */
export function TicketTracker({
	orgId,
	ticketId,
}: TicketTrackerProps): React.JSX.Element {
	const ticket = useActiveTicket(orgId, ticketId);
	const cancel = useCancelTicket(orgId, ticketId);
	const socketStatus = useSocketStatus((state) => state.status);
	const manualReconnect = useSocketStatus(
		(state) => state.manualReconnectAvailable,
	);

	const copy = useMemo(
		() => (ticket.projected ? statusCopy(ticket.projected) : null),
		[ticket.projected],
	);

	// Leave/cancel flow (R11.1/R11.3/R11.4). Confirm first, then call the public
	// ownership-scoped cancel mutation. On success stop live tracking (the hook
	// unsubscribes + flips to the "left" view); on a non-WAITING rejection
	// (QUEUE_INVALID_STATUS) refetch the ticket so the view reflects the real
	// state (R11.4); on 404/501 keep the ticket visible — no client-side faking.
	const { stopTracking, refresh } = ticket;
	const requestLeave = useCallback(() => {
		cancel.mutate(undefined, {
			onSuccess: () => {
				stopTracking();
			},
			onError: (error) => {
				if (isInvalidTicketStatusError(error)) {
					refresh();
				}
			},
		});
	}, [cancel, stopTracking, refresh]);

	const confirmLeave = useCallback(() => {
		Alert.alert(
			strings.ticket.leaveConfirmTitle,
			strings.ticket.leaveConfirmBody,
			[
				{ text: strings.common.cancel, style: "cancel" },
				{
					text: strings.ticket.leaveConfirm,
					style: "destructive",
					onPress: requestLeave,
				},
			],
		);
	}, [requestLeave]);

	// Map a failed cancel to user copy WITHOUT matching on message text (R10.4):
	// 404/501 → the "not available yet" copy (R11 backend dependency), otherwise
	// the code-mapped message (covers QUEUE_INVALID_STATUS, R11.4).
	const leaveMessage = cancel.isError
		? isCancelUnavailableError(cancel.error)
			? strings.ticket.leaveUnavailable
			: getErrorMessage(cancel.error)
		: null;

	const refreshControl = (
		<RefreshControl
			refreshing={ticket.isRefreshing}
			onRefresh={ticket.refresh}
		/>
	);

	// Loading state: first load with nothing cached to show yet.
	if (ticket.isLoading) {
		return (
			<View style={styles.centered}>
				<ActivityIndicator />
				<Text style={styles.mutedText}>{strings.common.loading}</Text>
			</View>
		);
	}

	// Left-the-queue state (R11.3): after a successful cancellation the customer
	// is no longer in the queue and live tracking has stopped.
	if (ticket.hasLeft) {
		return (
			<View style={styles.centered}>
				<Text style={styles.statusHeadline}>{strings.ticket.leftQueue}</Text>
			</View>
		);
	}

	// Error state: REST failed and there is no cached ticket to fall back to.
	if (ticket.isError || !ticket.projected || !copy) {
		return (
			<ScrollView
				contentContainerStyle={styles.centered}
				refreshControl={refreshControl}
			>
				<Text style={styles.errorTitle}>{strings.ticket.loadError}</Text>
				<Text style={styles.mutedText}>
					{getErrorMessage(ticket.errorCode)}
				</Text>
				<Pressable
					accessibilityRole="button"
					onPress={ticket.refresh}
					style={styles.secondaryButton}
				>
					<Text style={styles.secondaryLabel}>{strings.common.retry}</Text>
				</Pressable>
			</ScrollView>
		);
	}

	const { projected } = ticket;

	return (
		<ScrollView
			contentContainerStyle={styles.container}
			refreshControl={refreshControl}
		>
			{/* Stale indicator shown over cached data while offline (R9.2). */}
			{ticket.isStale ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={[styles.banner, styles.staleBanner]}
				>
					<Text style={styles.staleText}>{strings.offline.staleBanner}</Text>
				</View>
			) : null}

			{/* Reconnecting indicator + manual-reconnect affordance (R4.4/R4.5). */}
			{socketStatus === "reconnecting" ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="polite"
					style={[styles.banner, styles.reconnectBanner]}
				>
					<Text style={styles.reconnectText}>
						{strings.connection.reconnecting}
					</Text>
				</View>
			) : null}
			{socketStatus === "disconnected" && manualReconnect ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="polite"
					style={[styles.banner, styles.reconnectBanner]}
				>
					<Text style={styles.reconnectText}>
						{strings.connection.disconnected}
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={strings.connection.reconnect}
						onPress={() => reconnectNow()}
						style={styles.reconnectButton}
					>
						<Text style={styles.reconnectButtonLabel}>
							{strings.connection.reconnect}
						</Text>
					</Pressable>
				</View>
			) : null}

			<View style={styles.header}>
				<Text style={styles.title}>{strings.ticket.title}</Text>
			</View>

			<View style={styles.ticketCard}>
				<Text style={styles.ticketNumberLabel}>
					{strings.ticket.yourNumberLabel}
				</Text>
				<Text style={styles.ticketNumber}>{projected.ticketNumber}</Text>
			</View>

			{/*
			 * Live status. The headline/detail are TEXT (never color alone), so the
			 * "your turn" / "now serving" state is perceivable without color vision
			 * (R5.5 / accessibility baseline). A polite live region announces the
			 * change to assistive tech when the status updates from a ticket:update
			 * (R3.3), without interrupting the user mid-action.
			 */}
			<View
				accessibilityLiveRegion="polite"
				accessibilityLabel={`${copy.headline}. ${copy.detail}`}
				style={styles.statusBlock}
			>
				<Text style={styles.statusHeadline}>{copy.headline}</Text>
				<Text style={styles.statusDetail}>{copy.detail}</Text>
			</View>

			{/* Live queue figures: shown only when WAITING (R3.1); the projection
			    suppresses them otherwise, so terminal/called views stop presenting
			    live position (R3.5). */}
			{projected.position !== null ? (
				<View style={styles.metaRow}>
					<View style={styles.metaItem}>
						<Text style={styles.metaLabel}>{strings.ticket.positionLabel}</Text>
						<Text style={styles.metaValue}>{projected.position}</Text>
					</View>
					{projected.estimatedWaitMinutes !== null ? (
						<View style={styles.metaItem}>
							<Text style={styles.metaLabel}>
								{strings.ticket.estimatedWaitLabel}
							</Text>
							<Text style={styles.metaValue}>
								{formatWaitEstimate(projected.estimatedWaitMinutes)}
							</Text>
						</View>
					) : null}
				</View>
			) : null}

			{projected.service ? (
				<View style={styles.detailRow}>
					<Text style={styles.detailLabel}>{strings.ticket.serviceLabel}</Text>
					<Text style={styles.detailValue}>{projected.service.name}</Text>
				</View>
			) : null}

			{projected.counterName ? (
				<View style={styles.detailRow}>
					<Text style={styles.detailLabel}>{strings.ticket.counterLabel}</Text>
					<Text style={styles.detailValue}>{projected.counterName}</Text>
				</View>
			) : null}

			{/*
			 * Leave / cancel action (task 16.3, R11). Shown while the ticket is
			 * still WAITING — the only state the backend can cancel; a stale press
			 * after the status changed is handled by the QUEUE_INVALID_STATUS path
			 * (R11.4). The action is a LIVE request, so it is disabled offline with
			 * the existing reason (R9.5). On 404/501 the endpoint isn't available
			 * yet and we keep the ticket visible (no client-side faking).
			 */}
			{projected.status === TicketStatus.WAITING ? (
				<View style={styles.leaveBlock}>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{
							disabled: ticket.liveActionsDisabled || cancel.isPending,
							busy: cancel.isPending,
						}}
						disabled={ticket.liveActionsDisabled || cancel.isPending}
						onPress={confirmLeave}
						style={[
							styles.leaveButton,
							(ticket.liveActionsDisabled || cancel.isPending) &&
								styles.leaveButtonDisabled,
						]}
					>
						<Text style={styles.leaveLabel}>
							{cancel.isPending
								? strings.ticket.leavePending
								: strings.ticket.leaveButton}
						</Text>
					</Pressable>

					{leaveMessage ? (
						<Text
							accessibilityRole="alert"
							accessibilityLiveRegion="assertive"
							style={styles.leaveError}
						>
							{leaveMessage}
						</Text>
					) : null}

					{ticket.liveActionsDisabled && ticket.liveActionDisabledReason ? (
						<Text style={styles.offlineReason}>
							{ticket.liveActionDisabledReason}
						</Text>
					) : null}
				</View>
			) : null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	centered: {
		flexGrow: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		padding: 24,
	},
	container: {
		flexGrow: 1,
		padding: 24,
		gap: 20,
	},
	header: {
		gap: 6,
	},
	title: {
		fontSize: 22,
		fontWeight: "700",
	},
	banner: {
		borderRadius: 10,
		padding: 12,
		gap: 8,
	},
	staleBanner: {
		backgroundColor: "#fffbeb",
		borderColor: "#fde68a",
		borderWidth: 1,
	},
	staleText: {
		fontSize: 14,
		color: "#92400e",
	},
	reconnectBanner: {
		backgroundColor: "#eff6ff",
		borderColor: "#bfdbfe",
		borderWidth: 1,
		alignItems: "flex-start",
	},
	reconnectText: {
		fontSize: 14,
		color: "#1d4ed8",
	},
	reconnectButton: {
		paddingVertical: 8,
		paddingHorizontal: 16,
		borderRadius: 8,
		backgroundColor: "#2563eb",
	},
	reconnectButtonLabel: {
		color: "#ffffff",
		fontSize: 14,
		fontWeight: "600",
	},
	ticketCard: {
		alignItems: "center",
		gap: 8,
		paddingVertical: 28,
		borderRadius: 14,
		backgroundColor: "#eff6ff",
	},
	ticketNumberLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: "#2563eb",
	},
	ticketNumber: {
		fontSize: 48,
		fontWeight: "800",
		color: "#1d4ed8",
	},
	statusBlock: {
		gap: 6,
	},
	statusHeadline: {
		fontSize: 20,
		fontWeight: "700",
	},
	statusDetail: {
		fontSize: 15,
		opacity: 0.75,
	},
	metaRow: {
		flexDirection: "row",
		gap: 16,
	},
	metaItem: {
		flex: 1,
		gap: 4,
		padding: 16,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#e2e8f0",
	},
	metaLabel: {
		fontSize: 13,
		opacity: 0.6,
	},
	metaValue: {
		fontSize: 20,
		fontWeight: "700",
	},
	detailRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		paddingVertical: 12,
		borderBottomColor: "#e2e8f0",
		borderBottomWidth: 1,
	},
	detailLabel: {
		fontSize: 14,
		opacity: 0.6,
	},
	detailValue: {
		fontSize: 15,
		fontWeight: "600",
	},
	offlineReason: {
		fontSize: 13,
		opacity: 0.7,
		fontStyle: "italic",
	},
	leaveBlock: {
		gap: 8,
		marginTop: 4,
	},
	leaveButton: {
		paddingVertical: 14,
		paddingHorizontal: 24,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#dc2626",
		alignItems: "center",
	},
	leaveButtonDisabled: {
		opacity: 0.5,
	},
	leaveLabel: {
		color: "#dc2626",
		fontSize: 15,
		fontWeight: "600",
	},
	leaveError: {
		fontSize: 14,
		color: "#b91c1c",
	},
	errorTitle: {
		fontSize: 18,
		fontWeight: "700",
		textAlign: "center",
	},
	mutedText: {
		fontSize: 14,
		opacity: 0.7,
		textAlign: "center",
	},
	secondaryButton: {
		paddingVertical: 12,
		paddingHorizontal: 24,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#2563eb",
	},
	secondaryLabel: {
		color: "#2563eb",
		fontSize: 15,
		fontWeight: "600",
	},
});
