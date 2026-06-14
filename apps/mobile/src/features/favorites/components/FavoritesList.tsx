import { useMemo } from "react";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { DataRegion } from "@/components/DataRegion";
import { strings } from "@/i18n";
import { useAuthStore } from "@/lib/auth/auth-store";

import { useFavorites } from "../use-favorites";
import type { FavoriteItem } from "../types";

/**
 * Favorites screen (R8). Delegated to from the thin `app/(account)/favorites`
 * route.
 *
 * Behavior:
 *  - Signed out → an account prompt is shown in place of any list content; the
 *    favorites query stays disabled so no account data is fetched.
 *  - Signed in → the favorites are loaded through {@link useFavorites} and the
 *    loading / error / empty / content states are rendered by {@link DataRegion}
 *    with centralized i18n copy.
 *  - For each favorite the organization's name is shown together with a
 *    view-services action that navigates to `/join/[orgId]` so the customer can
 *    review the organization's services and rejoin (R8.4). The action is part of
 *    the list row, so it is only present while the favorites list is displayed.
 *
 * Favorites whose organization is no longer active resolve to `undefined`
 * organization details from the backend; those rows are filtered out so the
 * list always shows an organization name and a usable view-services target.
 */
export function FavoritesList(): React.JSX.Element {
	const router = useRouter();
	const isSignedIn = useAuthStore((state) => state.status === "signed-in");
	const favorites = useFavorites();

	// Only render favorites that still resolve to an (active) organization, so
	// every row has a name and a valid view-services target (R8.4).
	const items = useMemo<FavoriteItem[]>(
		() => (favorites.data ?? []).filter((item) => Boolean(item.organization)),
		[favorites.data],
	);

	// Signed out → account prompt instead of list content.
	if (!isSignedIn) {
		return (
			<View style={styles.prompt}>
				<Text style={styles.promptText}>{strings.favorites.signInPrompt}</Text>
				<Pressable
					accessibilityRole="button"
					onPress={() => router.push("/(account)/sign-in")}
					style={styles.promptButton}
				>
					<Text style={styles.promptButtonLabel}>
						{strings.auth.signInSubmit}
					</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<DataRegion
			isLoading={favorites.isPending}
			isError={favorites.isError}
			isEmpty={items.length === 0}
			errorText={strings.favorites.loadError}
			emptyText={strings.favorites.empty}
			onRetry={() => {
				void favorites.refetch();
			}}
		>
			<FlatList
				contentContainerStyle={styles.listContent}
				data={items}
				keyExtractor={(item) => item.id}
				renderItem={({ item }) => (
					<View style={styles.row}>
						<View style={styles.rowText}>
							<Text style={styles.orgLabel}>
								{strings.favorites.organizationLabel}
							</Text>
							<Text style={styles.orgName}>{item.organization?.name}</Text>
						</View>
						<Pressable
							accessibilityRole="button"
							onPress={() => router.push(`/join/${item.orgId}`)}
							style={styles.viewButton}
						>
							<Text style={styles.viewButtonLabel}>
								{strings.favorites.viewServices}
							</Text>
						</Pressable>
					</View>
				)}
			/>
		</DataRegion>
	);
}

const styles = StyleSheet.create({
	listContent: {
		padding: 16,
		gap: 12,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		padding: 16,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#e2e8f0",
	},
	rowText: {
		flex: 1,
		gap: 4,
	},
	orgLabel: {
		fontSize: 12,
		opacity: 0.6,
	},
	orgName: {
		fontSize: 17,
		fontWeight: "600",
	},
	viewButton: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 8,
		backgroundColor: "#2563eb",
	},
	viewButtonLabel: {
		color: "#ffffff",
		fontSize: 14,
		fontWeight: "600",
	},
	prompt: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 16,
	},
	promptText: {
		fontSize: 15,
		textAlign: "center",
		opacity: 0.7,
	},
	promptButton: {
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderRadius: 10,
		backgroundColor: "#2563eb",
	},
	promptButtonLabel: {
		color: "#ffffff",
		fontSize: 15,
		fontWeight: "600",
	},
});
