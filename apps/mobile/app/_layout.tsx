import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { InAppTurnBanner } from "@/components/InAppTurnBanner";
import {
	installUnauthorizedHandler,
	startConnectivityWiring,
	startPushWiring,
} from "@/lib/boot";
import { queryClient } from "@/lib/api/query-client";
import { assertSharedPackagesPresent } from "@/lib/shared-packages";

// Fail fast at boot if any of the three shared workspace packages is missing (R14.4).
// Evaluated at module load so it runs before the app renders.
assertSharedPackagesPresent();

// Wire the REST client's return-to-sign-in signal to navigation + cache cleanup
// (R12.4). Registration only; the effect fires later, when a refresh fails.
installUnauthorizedHandler();

/**
 * Root layout. Provides the TanStack Query client to the tree (server state for
 * discovery, queue, account features). Later tasks add Auth, Socket, and
 * Notification providers here.
 */
export default function RootLayout(): React.JSX.Element {
	// Start push deep-linking + best-effort token registration once the
	// navigation tree is mounted (R13.1, R13.3, R13.4). Torn down on unmount.
	useEffect(() => startPushWiring(), []);

	// Wire device connectivity into the offline UI, live-action gating, and
	// connectivity-restore re-subscription/refetch app-wide (R9.2, R9.3, R9.5).
	// Torn down on unmount.
	useEffect(() => startConnectivityWiring(), []);

	return (
		<QueryClientProvider client={queryClient}>
			<StatusBar style="auto" />
			<Stack>
				<Stack.Screen name="index" options={{ title: "QueueNow" }} />
				<Stack.Screen name="scan" options={{ title: "Scan" }} />
				<Stack.Screen name="join/[orgId]" options={{ title: "Join queue" }} />
				<Stack.Screen name="(account)" options={{ headerShown: false }} />
			</Stack>
			{/*
			 * Foreground turn-alert banner (R5.5). Mounted once at the root and
			 * overlaid above the navigator so a raised banner is shown — and
			 * announced to assistive tech — on whatever screen is active. Returns
			 * null when no banner is raised. The audible fallback fires from the
			 * Notification_Manager alongside the banner.
			 */}
			<InAppTurnBanner />
		</QueryClientProvider>
	);
}
