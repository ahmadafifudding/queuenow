import { useState } from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useRouter } from "expo-router";

import { strings } from "@/i18n";
import { useAuthStore } from "@/lib/auth/auth-store";

import { manualDiscoveryTarget } from "../parse-discovery-url";

/**
 * Home / discovery entry (R1.2). Lets the customer:
 *  - open the QR scanner,
 *  - enter an organization code manually, or
 *  - jump to their saved favorites (account feature, screen built in task 13.1).
 *
 * Manual entry is validated by the pure {@link manualDiscoveryTarget} before we
 * navigate to the service-selection screen (`/join/[orgId]`), which performs the
 * actual status resolution. The entered code is used as the org identifier (see
 * the slug→orgId resolution note in `parse-discovery-url.ts`).
 */
export function DiscoveryHome(): React.JSX.Element {
	const router = useRouter();
	const isSignedIn = useAuthStore((state) => state.status === "signed-in");
	const [code, setCode] = useState("");

	const target = manualDiscoveryTarget(code);
	const canSubmit = target !== null;

	const submitManualCode = (): void => {
		if (!target?.slug) {
			return;
		}
		router.push({ pathname: "/join/[orgId]", params: { orgId: target.slug } });
	};

	return (
		<ScrollView contentContainerStyle={styles.container}>
			<View style={styles.header}>
				<Text style={styles.title}>{strings.discovery.title}</Text>
				<Text style={styles.subtitle}>{strings.discovery.subtitle}</Text>
			</View>

			<Pressable
				accessibilityRole="button"
				onPress={() => router.push("/scan")}
				style={styles.scanButton}
			>
				<Text style={styles.scanButtonLabel}>
					{strings.discovery.scanButton}
				</Text>
			</Pressable>

			<View style={styles.field}>
				<Text style={styles.label}>{strings.discovery.manualCodeLabel}</Text>
				<TextInput
					value={code}
					onChangeText={setCode}
					placeholder={strings.discovery.manualCodePlaceholder}
					autoCapitalize="none"
					autoCorrect={false}
					returnKeyType="go"
					onSubmitEditing={submitManualCode}
					style={styles.input}
					accessibilityLabel={strings.discovery.manualCodeLabel}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityState={{ disabled: !canSubmit }}
					disabled={!canSubmit}
					onPress={submitManualCode}
					style={[
						styles.submitButton,
						!canSubmit && styles.submitButtonDisabled,
					]}
				>
					<Text style={styles.submitLabel}>
						{strings.discovery.manualCodeSubmit}
					</Text>
				</Pressable>
			</View>

			{isSignedIn ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => router.push("/(account)/favorites")}
					style={styles.shortcut}
				>
					<Text style={styles.shortcutLabel}>
						{strings.discovery.favoritesShortcut}
					</Text>
				</Pressable>
			) : null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flexGrow: 1,
		padding: 24,
		gap: 24,
	},
	header: {
		gap: 8,
	},
	title: {
		fontSize: 24,
		fontWeight: "700",
	},
	subtitle: {
		fontSize: 15,
		opacity: 0.7,
	},
	scanButton: {
		paddingVertical: 16,
		borderRadius: 10,
		backgroundColor: "#2563eb",
		alignItems: "center",
	},
	scanButtonLabel: {
		color: "#ffffff",
		fontSize: 16,
		fontWeight: "600",
	},
	field: {
		gap: 10,
	},
	label: {
		fontSize: 14,
		fontWeight: "600",
	},
	input: {
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 8,
		paddingHorizontal: 14,
		paddingVertical: 12,
		fontSize: 16,
	},
	submitButton: {
		paddingVertical: 14,
		borderRadius: 8,
		backgroundColor: "#0f172a",
		alignItems: "center",
	},
	submitButtonDisabled: {
		opacity: 0.4,
	},
	submitLabel: {
		color: "#ffffff",
		fontSize: 15,
		fontWeight: "600",
	},
	shortcut: {
		paddingVertical: 14,
		alignItems: "center",
	},
	shortcutLabel: {
		fontSize: 15,
		color: "#2563eb",
		fontWeight: "600",
	},
});
