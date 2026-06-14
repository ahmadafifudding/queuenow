import { FlatList, StyleSheet, Text, View } from "react-native";

import { DataRegion } from "@/components/DataRegion";
import { strings } from "@/i18n";

import { toNotificationDisplay } from "../notification-display";
import type { NotificationListItem } from "../types";
import { useNotificationsList } from "../use-notifications";

/**
 * Persisted notifications list screen (R5.7).
 *
 * WHERE the customer is signed in, retrieves `GET /notifications` and displays
 * the entries in reverse chronological order (the hook orders them). WHERE the
 * customer is signed out, an account prompt is shown in place of any list
 * content. Loading / error / empty states use the shared {@link DataRegion}
 * with centralized i18n copy.
 */
export function NotificationsList(): React.JSX.Element {
	const { notifications, isSignedIn, isLoading, isError, isEmpty, refetch } =
		useNotificationsList();

	// Signed-out: account prompt instead of (and hiding) any list content.
	if (!isSignedIn) {
		return (
			<View style={styles.prompt}>
				<Text style={styles.promptTitle}>
					{strings.notifications.listTitle}
				</Text>
				<Text style={styles.promptBody}>
					{strings.notifications.signInPrompt}
				</Text>
			</View>
		);
	}

	return (
		<DataRegion
			isLoading={isLoading}
			isError={isError}
			isEmpty={isEmpty}
			errorText={strings.notifications.listError}
			emptyText={strings.notifications.listEmpty}
			onRetry={refetch}
		>
			<FlatList
				data={notifications}
				keyExtractor={(item) => item.id}
				contentContainerStyle={styles.listContent}
				renderItem={({ item }) => <NotificationRow item={item} />}
			/>
		</DataRegion>
	);
}

interface NotificationRowProps {
	item: NotificationListItem;
}

/** A single notification row: type-derived title/body, meta, and timestamp. */
function NotificationRow({ item }: NotificationRowProps): React.JSX.Element {
	const display = toNotificationDisplay(item);
	return (
		<View style={styles.row}>
			<Text style={styles.rowTitle}>{display.title}</Text>
			<Text style={styles.rowBody}>{display.body}</Text>
			{display.meta ? <Text style={styles.rowMeta}>{display.meta}</Text> : null}
			<Text style={styles.rowTime}>{formatTimestamp(display.createdAt)}</Text>
		</View>
	);
}

/**
 * Render a notification's ISO `createdAt` as a readable absolute date + time.
 * The persisted list item carries no organization timezone, so this uses the
 * device locale for display only; ordering is driven by the raw ISO value.
 */
function formatTimestamp(createdAt: string): string {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) {
		return createdAt;
	}
	return new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

const styles = StyleSheet.create({
	listContent: {
		padding: 16,
		gap: 12,
	},
	row: {
		borderWidth: 1,
		borderColor: "#e2e8f0",
		borderRadius: 10,
		padding: 16,
		gap: 4,
	},
	rowTitle: {
		fontSize: 16,
		fontWeight: "600",
	},
	rowBody: {
		fontSize: 14,
		opacity: 0.8,
	},
	rowMeta: {
		fontSize: 13,
		color: "#2563eb",
		fontWeight: "600",
	},
	rowTime: {
		fontSize: 12,
		opacity: 0.5,
		marginTop: 2,
	},
	prompt: {
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
	promptBody: {
		fontSize: 15,
		textAlign: "center",
		opacity: 0.7,
	},
});
