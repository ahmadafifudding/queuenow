import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	View,
} from "react-native";

import { strings } from "@/i18n";

/**
 * Props for {@link DataRegion}. A data region renders exactly one of four
 * states — loading, error, empty, or its `children` (the loaded content) — so
 * primary content never falls back to a bare spinner-only screen (per the web
 * UX conventions, reused here for the mobile app).
 */
export interface DataRegionProps {
	/** True while the underlying data is loading. */
	isLoading: boolean;
	/** True when loading failed; renders the error state with a retry action. */
	isError?: boolean;
	/** True when there is no content to show; renders the empty state. */
	isEmpty?: boolean;
	/** Copy shown in the loading state. Defaults to the shared loading string. */
	loadingText?: string;
	/** Copy shown in the error state. Defaults to the shared error string. */
	errorText?: string;
	/** Copy shown in the empty state. Defaults to the shared empty string. */
	emptyText?: string;
	/** Invoked when the user taps Retry in the error state. */
	onRetry?: () => void;
	/** The loaded content, rendered when not loading/error/empty. */
	children: React.ReactNode;
}

/**
 * Render explicit loading / error / empty / content states for a data region
 * with centralized i18n copy. Precedence is loading → error → empty → content,
 * so a screen passes the same query flags it already has and gets consistent
 * states without bespoke conditionals.
 */
export function DataRegion({
	isLoading,
	isError = false,
	isEmpty = false,
	loadingText,
	errorText,
	emptyText,
	onRetry,
	children,
}: DataRegionProps): React.JSX.Element {
	if (isLoading) {
		return (
			<View style={styles.state} accessibilityRole="progressbar">
				<ActivityIndicator />
				<Text style={styles.stateText}>
					{loadingText ?? strings.common.loading}
				</Text>
			</View>
		);
	}

	if (isError) {
		return (
			<View style={styles.state}>
				<Text style={styles.stateText}>
					{errorText ?? strings.common.error}
				</Text>
				{onRetry ? (
					<Pressable
						accessibilityRole="button"
						onPress={onRetry}
						style={styles.retryButton}
					>
						<Text style={styles.retryLabel}>{strings.common.retry}</Text>
					</Pressable>
				) : null}
			</View>
		);
	}

	if (isEmpty) {
		return (
			<View style={styles.state}>
				<Text style={styles.stateText}>
					{emptyText ?? strings.common.empty}
				</Text>
			</View>
		);
	}

	return <>{children}</>;
}

const styles = StyleSheet.create({
	state: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 12,
	},
	stateText: {
		fontSize: 15,
		textAlign: "center",
		opacity: 0.7,
	},
	retryButton: {
		marginTop: 4,
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 8,
		backgroundColor: "#2563eb",
	},
	retryLabel: {
		color: "#ffffff",
		fontSize: 15,
		fontWeight: "600",
	},
});
