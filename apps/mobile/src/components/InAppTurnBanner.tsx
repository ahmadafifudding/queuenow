import { Pressable, StyleSheet, Text, View } from "react-native";

import { strings } from "@/i18n";
import { useInAppBannerStore } from "@/lib/notifications/in-app-banner";

/**
 * Foreground turn-alert banner renderer (R5.5).
 *
 * The Notification_Manager raises a persistent in-app banner (via the
 * {@link useInAppBannerStore}) when OS local-notification permission is denied
 * and the app is foregrounded — the audible fallback fires alongside it in the
 * manager. This component is the missing renderer for that store: it is mounted
 * once at the app root so a raised banner is actually shown and, crucially,
 * **announced** to assistive technology.
 *
 * Accessibility:
 *  - The banner region is an `alert` with `accessibilityLiveRegion="assertive"`
 *    so screen readers interrupt and announce the turn alert the moment it is
 *    raised — a turn alert is time-critical and must not wait for focus.
 *  - The alert is conveyed by TEXT (title + body), never by color alone, so the
 *    "your turn" state is perceivable without color vision.
 *  - The dismiss control is a labeled `button` with an explicit hit target.
 *  - Text uses default `allowFontScaling`, so the banner honors the OS dynamic
 *    type setting.
 */
export function InAppTurnBanner(): React.JSX.Element | null {
	const banner = useInAppBannerStore((state) => state.banner);
	const dismiss = useInAppBannerStore((state) => state.dismiss);

	if (!banner) {
		return null;
	}

	return (
		<View
			accessibilityRole="alert"
			accessibilityLiveRegion="assertive"
			accessibilityLabel={strings.notifications.bannerRegionLabel}
			style={styles.container}
			pointerEvents="box-none"
		>
			<View style={styles.banner}>
				<View style={styles.text}>
					<Text style={styles.title}>{banner.title}</Text>
					<Text style={styles.body}>{banner.body}</Text>
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={strings.common.dismiss}
					hitSlop={8}
					onPress={dismiss}
					style={styles.dismiss}
				>
					<Text style={styles.dismissLabel}>{strings.common.dismiss}</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		paddingTop: 56,
		paddingHorizontal: 16,
	},
	banner: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#bfdbfe",
		backgroundColor: "#eff6ff",
		paddingHorizontal: 16,
		paddingVertical: 14,
	},
	text: {
		flex: 1,
		gap: 4,
	},
	title: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1d4ed8",
	},
	body: {
		fontSize: 14,
		color: "#1e3a8a",
	},
	dismiss: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
	},
	dismissLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: "#2563eb",
	},
});
