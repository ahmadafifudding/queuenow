import { StyleSheet, Text, View } from "react-native";

export interface PlaceholderProps {
	title: string;
	subtitle?: string;
}

/**
 * Minimal screen placeholder used by the route scaffolding (task 1.1).
 * Feature tasks replace these with real feature components delegated from `app/`.
 */
export function Placeholder({
	title,
	subtitle,
}: PlaceholderProps): React.JSX.Element {
	return (
		<View style={styles.container}>
			<Text style={styles.title}>{title}</Text>
			{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
	},
	title: {
		fontSize: 20,
		fontWeight: "600",
	},
	subtitle: {
		marginTop: 8,
		fontSize: 14,
		opacity: 0.6,
	},
});
