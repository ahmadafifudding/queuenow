import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLiveActionGate } from "@/lib/connectivity";

/** Props for {@link SubmitButton}. */
export interface SubmitButtonProps {
	/** Label shown when idle. */
	label: string;
	/** Label shown while the action is pending. */
	pendingLabel: string;
	/** True while the submit action is in flight; disables the button (R6 forms). */
	isPending: boolean;
	/** Invoked when the button is pressed (ignored while pending). */
	onPress: () => void;
}

/**
 * Primary submit button for the auth forms (register / sign-in). It is disabled
 * while `isPending`, so a request can never be double-submitted (forms-and-
 * validation convention), AND while the device is offline, since register/login
 * are live requests (R9.5). When disabled offline it surfaces the stated reason
 * from the i18n catalog via the shared {@link useLiveActionGate} so the gating is
 * consistent with the other live actions across the app.
 */
export function SubmitButton({
	label,
	pendingLabel,
	isPending,
	onPress,
}: SubmitButtonProps): React.JSX.Element {
	const gate = useLiveActionGate(isPending);

	return (
		<View style={styles.wrapper}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ disabled: gate.disabled, busy: isPending }}
				disabled={gate.disabled}
				onPress={onPress}
				style={[styles.button, gate.disabled ? styles.buttonDisabled : null]}
			>
				<Text style={styles.label}>{isPending ? pendingLabel : label}</Text>
			</Pressable>

			{gate.reason ? (
				<Text style={styles.offlineReason}>{gate.reason}</Text>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	wrapper: {
		gap: 8,
	},
	button: {
		paddingVertical: 16,
		borderRadius: 10,
		backgroundColor: "#2563eb",
		alignItems: "center",
	},
	buttonDisabled: {
		opacity: 0.5,
	},
	label: {
		color: "#ffffff",
		fontSize: 16,
		fontWeight: "600",
	},
	offlineReason: {
		fontSize: 13,
		opacity: 0.7,
		fontStyle: "italic",
		textAlign: "center",
	},
});
