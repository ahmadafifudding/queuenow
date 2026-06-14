import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
	type BarcodeScanningResult,
	CameraView,
	useCameraPermissions,
} from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";

import { strings } from "@/i18n";

import { parseDiscoveryUrl } from "../parse-discovery-url";

/**
 * QR scanner screen (R1.1, R1.3). Opens the camera, decodes a QR code, and
 * parses it with the PURE {@link parseDiscoveryUrl}. On a recognized join deep
 * link it navigates to the service-selection screen (`/join/[orgId]`), passing
 * the optional scanned `serviceId` through; unrecognized codes are ignored so
 * the customer can keep scanning. Camera permission is requested explicitly and
 * a clear rationale + action is shown when it has not been granted.
 *
 * Status resolution and the join-availability decision happen on the
 * destination screen — this screen is purely discovery input.
 */
export function QrScanner(): React.JSX.Element {
	const router = useRouter();
	const [permission, requestPermission] = useCameraPermissions();
	// Guard against the scanner firing repeatedly for the same frame.
	const [scanned, setScanned] = useState(false);
	const handledRef = useRef(false);

	// Reset the scan lock whenever the screen regains focus (e.g. back navigation).
	useFocusEffect(
		useCallback(() => {
			setScanned(false);
			handledRef.current = false;
			return undefined;
		}, []),
	);

	const onBarcodeScanned = useCallback(
		(result: BarcodeScanningResult): void => {
			if (handledRef.current) {
				return;
			}
			const target = parseDiscoveryUrl(result.data);
			if (!target?.slug) {
				// Not a recognizable join deep link — keep scanning.
				return;
			}
			handledRef.current = true;
			setScanned(true);
			router.replace({
				pathname: "/join/[orgId]",
				params: target.serviceId
					? { orgId: target.slug, service: target.serviceId }
					: { orgId: target.slug },
			});
		},
		[router],
	);

	// Permission still loading.
	if (!permission) {
		return (
			<View style={styles.center}>
				<Text style={styles.bodyText}>{strings.common.loading}</Text>
			</View>
		);
	}

	// Permission not granted — explain why and offer to request it.
	if (!permission.granted) {
		return (
			<View style={styles.center}>
				<Text style={styles.title}>
					{strings.discovery.cameraPermissionTitle}
				</Text>
				<Text style={styles.bodyText}>
					{strings.discovery.cameraPermissionBody}
				</Text>
				<Pressable
					accessibilityRole="button"
					onPress={() => {
						void requestPermission();
					}}
					style={styles.button}
				>
					<Text style={styles.buttonLabel}>
						{strings.discovery.cameraPermissionAction}
					</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View style={styles.scannerContainer}>
			<CameraView
				style={StyleSheet.absoluteFill}
				facing="back"
				barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
				onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
			/>
			<View style={styles.hintBar} pointerEvents="none">
				<Text style={styles.hintText}>{strings.discovery.scanHint}</Text>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	scannerContainer: {
		flex: 1,
		backgroundColor: "#000000",
	},
	hintBar: {
		position: "absolute",
		bottom: 48,
		left: 0,
		right: 0,
		alignItems: "center",
		paddingHorizontal: 24,
	},
	hintText: {
		color: "#ffffff",
		fontSize: 15,
		textAlign: "center",
		backgroundColor: "rgba(0,0,0,0.55)",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 8,
		overflow: "hidden",
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 12,
	},
	title: {
		fontSize: 18,
		fontWeight: "700",
		textAlign: "center",
	},
	bodyText: {
		fontSize: 15,
		textAlign: "center",
		opacity: 0.7,
	},
	button: {
		marginTop: 8,
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderRadius: 8,
		backgroundColor: "#2563eb",
	},
	buttonLabel: {
		color: "#ffffff",
		fontSize: 15,
		fontWeight: "600",
	},
});
