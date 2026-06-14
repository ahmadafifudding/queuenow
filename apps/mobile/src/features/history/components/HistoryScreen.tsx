import { ScrollView, StyleSheet, Text, View } from "react-native";

import { DataRegion } from "@/components/DataRegion";
import { strings } from "@/i18n";
import { useAuthStore } from "@/lib/auth/auth-store";

import type { HistoryRow } from "../types";
import { useTicketHistory } from "../use-ticket-history";

/**
 * Ticket history screen (R7).
 *
 * Behaviour:
 *  - SIGNED OUT (R7.4): renders an account prompt in place of history and hides
 *    ALL history content — including any history cached from a previous session.
 *    Because this gate is on the live session status (and the query is disabled
 *    while signed out), no cached account data can leak through.
 *  - SIGNED IN (R7.1–R7.3): fetches `GET /customers/history` via
 *    {@link useTicketHistory} and renders DataRegion loading / error / empty
 *    states with centralized copy, then each row's organization name, service
 *    name, `ticketNumber`, and status — ordered most-recent-first.
 */
export function HistoryScreen(): React.JSX.Element {
	const isSignedIn = useAuthStore((state) => state.status === "signed-in");

	if (!isSignedIn) {
		// R7.4 — account prompt only; no history content (cached or otherwise).
		return (
			<View style={styles.promptState}>
				<Text style={styles.promptTitle}>{strings.history.title}</Text>
				<Text style={styles.promptText}>{strings.history.signInPrompt}</Text>
			</View>
		);
	}

	return <SignedInHistory />;
}

/** The signed-in history list; mounted only when a session is active (R7.4). */
function SignedInHistory(): React.JSX.Element {
	const { data, isPending, isError, refetch } = useTicketHistory();
	const rows = data ?? [];

	return (
		<DataRegion
			isLoading={isPending}
			isError={isError}
			isEmpty={rows.length === 0}
			errorText={strings.history.loadError}
			emptyText={strings.history.empty}
			onRetry={() => {
				void refetch();
			}}
		>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.header}>
					<Text style={styles.title}>{strings.history.title}</Text>
					<Text style={styles.subtitle}>{strings.history.subtitle}</Text>
				</View>

				<View style={styles.list}>
					{rows.map((row) => (
						<HistoryListRow key={row.id} row={row} />
					))}
				</View>
			</ScrollView>
		</DataRegion>
	);
}

interface HistoryListRowProps {
	row: HistoryRow;
}

/** A single history entry: organization, service, ticket number, and status (R7.2). */
function HistoryListRow({ row }: HistoryListRowProps): React.JSX.Element {
	const statusLabel = strings.history.status[row.status] ?? row.status;
	return (
		<View style={styles.row}>
			<View style={styles.rowMain}>
				<Text style={styles.orgName}>{row.organizationName}</Text>
				<Text style={styles.serviceName}>{row.serviceName}</Text>
			</View>
			<View style={styles.rowMeta}>
				<Text style={styles.ticketNumber}>{row.ticketNumber}</Text>
				<Text style={styles.status}>{statusLabel}</Text>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
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
	subtitle: {
		fontSize: 14,
		opacity: 0.7,
	},
	list: {
		gap: 12,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderWidth: 1,
		borderColor: "#e2e8f0",
		borderRadius: 10,
		paddingHorizontal: 16,
		paddingVertical: 14,
	},
	rowMain: {
		flex: 1,
		gap: 4,
	},
	orgName: {
		fontSize: 16,
		fontWeight: "600",
	},
	serviceName: {
		fontSize: 13,
		opacity: 0.6,
	},
	rowMeta: {
		alignItems: "flex-end",
		gap: 4,
		marginLeft: 12,
	},
	ticketNumber: {
		fontSize: 16,
		fontWeight: "700",
		color: "#2563eb",
	},
	status: {
		fontSize: 12,
		fontWeight: "600",
		color: "#64748b",
		textTransform: "uppercase",
	},
	promptState: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 8,
	},
	promptTitle: {
		fontSize: 20,
		fontWeight: "700",
	},
	promptText: {
		fontSize: 15,
		textAlign: "center",
		opacity: 0.7,
	},
});
