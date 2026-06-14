import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import { strings } from "@/i18n";
import { useAuthStore } from "@/lib/auth/auth-store";

import { useSignOut } from "../hooks/use-sign-out";

/**
 * Sign-out action for the account area (R6.6). Rendered in the account stack
 * header; it only appears while signed in (driven by the in-memory session
 * mirror). On press it runs `authManager.signOut` — which clears tokens and
 * account-scoped query data — then routes to the signed-out sign-in view.
 */
export function SignOutButton(): React.JSX.Element | null {
	const router = useRouter();
	const isSignedIn = useAuthStore((state) => state.status === "signed-in");
	const signOut = useSignOut();

	if (!isSignedIn) {
		return null;
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{
				disabled: signOut.isPending,
				busy: signOut.isPending,
			}}
			disabled={signOut.isPending}
			onPress={() => {
				signOut.mutate(undefined, {
					onSuccess: () => {
						router.replace("/(account)/sign-in");
					},
				});
			}}
			style={styles.button}
		>
			<Text style={styles.label}>{strings.auth.signOut}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	button: {
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	label: {
		fontSize: 15,
		color: "#2563eb",
		fontWeight: "600",
	},
});
