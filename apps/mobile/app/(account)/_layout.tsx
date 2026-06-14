import { Stack } from "expo-router";

import { SignOutButton } from "@/features/auth";
import { strings } from "@/i18n";

// Account route group (auth + account-scoped screens). See R6, R7, R8, R5.7.
// A sign-out action (R6.6) is provided in the header and shows only while
// signed in; it clears the session and routes back to the signed-out view.
export default function AccountLayout(): React.JSX.Element {
	return (
		<Stack screenOptions={{ headerRight: () => <SignOutButton /> }}>
			<Stack.Screen
				name="sign-in"
				options={{ title: strings.auth.signInTitle }}
			/>
			<Stack.Screen
				name="register"
				options={{ title: strings.auth.registerTitle }}
			/>
			<Stack.Screen name="history" options={{ title: strings.history.title }} />
			<Stack.Screen
				name="favorites"
				options={{ title: strings.favorites.title }}
			/>
			<Stack.Screen
				name="notifications"
				options={{ title: strings.notifications.listTitle }}
			/>
		</Stack>
	);
}
