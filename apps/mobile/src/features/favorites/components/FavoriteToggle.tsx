import { Pressable, StyleSheet, Text } from "react-native";

import { strings } from "@/i18n";
import { useAuthStore } from "@/lib/auth/auth-store";

import { isOrgFavorited } from "../favorite-selectors";
import {
	useAddFavorite,
	useFavorites,
	useRemoveFavorite,
} from "../use-favorites";

/** Props for {@link FavoriteToggle}. */
export interface FavoriteToggleProps {
	/** Canonical organization id the add/remove endpoints are keyed on (R8.2, R8.3). */
	orgId: string;
}

/**
 * Add / remove an organization from favorites (R8.2, R8.3).
 *
 * Renders a single toggle button whose label and action reflect whether the org
 * is already a favorite (derived via {@link isOrgFavorited} from the shared
 * {@link useFavorites} cache, so the state stays in sync with the favorites
 * screen). The control is:
 *  - hidden while signed out (favorites are account-scoped; the query is
 *    disabled and there is nothing to toggle), and
 *  - hidden until a valid `orgId` is known, so we never POST/DELETE an empty id.
 *
 * It is disabled while the favorites list is still loading or a mutation is in
 * flight, preventing a double add/remove. Mutations invalidate the favorites
 * cache on success (see the hooks), so the label flips automatically.
 */
export function FavoriteToggle({
	orgId,
}: FavoriteToggleProps): React.JSX.Element | null {
	const isSignedIn = useAuthStore((state) => state.status === "signed-in");
	const favorites = useFavorites();
	const addFavorite = useAddFavorite();
	const removeFavorite = useRemoveFavorite();

	// Account-scoped: nothing to toggle while signed out or before the org id is
	// resolved.
	if (!isSignedIn || orgId === "") {
		return null;
	}

	const favorited = isOrgFavorited(favorites.data, orgId);
	const isBusy =
		favorites.isPending || addFavorite.isPending || removeFavorite.isPending;

	const handlePress = (): void => {
		if (isBusy) {
			return;
		}
		if (favorited) {
			removeFavorite.mutate(orgId);
		} else {
			addFavorite.mutate(orgId);
		}
	};

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled: isBusy, selected: favorited }}
			disabled={isBusy}
			onPress={handlePress}
			style={[
				styles.toggle,
				favorited && styles.toggleActive,
				isBusy && styles.toggleDisabled,
			]}
		>
			<Text style={[styles.label, favorited && styles.labelActive]}>
				{favorited ? strings.favorites.remove : strings.favorites.add}
			</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	toggle: {
		alignSelf: "flex-start",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: "#2563eb",
		backgroundColor: "#ffffff",
	},
	toggleActive: {
		backgroundColor: "#2563eb",
	},
	toggleDisabled: {
		opacity: 0.5,
	},
	label: {
		fontSize: 13,
		fontWeight: "600",
		color: "#2563eb",
	},
	labelActive: {
		color: "#ffffff",
	},
});
