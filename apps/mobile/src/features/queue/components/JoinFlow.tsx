import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";

import { ServiceSelection, useDiscovery } from "@/features/discovery";
import type { DiscoveryTarget } from "@/features/discovery";
import { strings } from "@/i18n";
import { getErrorMessage } from "@/lib/api/error-map";
import { useLiveActionGate } from "@/lib/connectivity";
import { formatWaitEstimate } from "@/lib/format";

import { toJoinedTicketDisplay } from "../build-join-request";
import { isQueueFullError, useJoinQueue } from "../use-join-queue";

/** The stages of the join flow: pick a service, add details + join, see result. */
type JoinStage = "select" | "details" | "result";

/** Props for {@link JoinFlow}. The route supplies the resolved discovery target. */
export interface JoinFlowProps {
	/** The discovery target resolved from the route params. */
	target: DiscoveryTarget;
}

/**
 * Join queue + ticket result flow (R2).
 *
 * Stages:
 *  - `select`: delegate to {@link ServiceSelection}; its `onJoin` seam supplies
 *    the chosen service id and advances to `details`.
 *  - `details`: optional name/phone fields (R2.2) + a join button disabled while
 *    the request is in flight. On `QUEUE_FULL` it shows the mapped queue-full
 *    copy and issues/displays NO ticket (R2.5); on other errors it shows the
 *    code-mapped message.
 *  - `result`: the issued `ticketNumber`, the `position` verbatim, and the
 *    `estimatedWaitMinutes` (humanized) — no client offset (R2.4) — plus a
 *    "Track my ticket" action that navigates to the tracking screen (task 9.1).
 */
export function JoinFlow({ target }: JoinFlowProps): React.JSX.Element {
	const router = useRouter();
	const { organizationId, orgIdentifier, organizationName, decision } =
		useDiscovery(target);

	// The join endpoint is org-id-scoped; prefer the canonical id from the status
	// response, falling back to the resolved identifier (R2.1).
	const joinOrgId = organizationId ?? orgIdentifier ?? "";
	const mutation = useJoinQueue(joinOrgId);

	const [stage, setStage] = useState<JoinStage>("select");
	const [serviceId, setServiceId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");

	const selectedService = useMemo(
		() =>
			decision?.services.find((service) => service.id === serviceId) ?? null,
		[decision?.services, serviceId],
	);

	// Join is a LIVE request, so it is disabled offline with the stated reason
	// (R9.5) and while a join is already in flight, consistent with the other
	// live actions across the app. Called unconditionally before any early
	// return so hook order stays stable across stages.
	const gate = useLiveActionGate(mutation.isPending);

	// Stage 1 — service selection. The onJoin seam advances to the details stage.
	if (stage === "select") {
		return (
			<ServiceSelection
				target={target}
				onJoin={(chosenServiceId) => {
					setServiceId(chosenServiceId);
					setStage("details");
				}}
			/>
		);
	}

	// Stage 3 — ticket result (R2.4). Values are shown verbatim from the backend.
	if (stage === "result" && mutation.data) {
		const display = toJoinedTicketDisplay(mutation.data);
		const ticket = mutation.data;
		return (
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.resultHeader}>
					<Text style={styles.resultTitle}>{strings.join.ticketTitle}</Text>
				</View>

				<View style={styles.ticketCard}>
					<Text style={styles.ticketNumberLabel}>
						{strings.join.yourNumberLabel}
					</Text>
					<Text style={styles.ticketNumber}>{display.ticketNumber}</Text>
				</View>

				<View style={styles.metaRow}>
					<View style={styles.metaItem}>
						<Text style={styles.metaLabel}>{strings.join.positionLabel}</Text>
						<Text style={styles.metaValue}>{display.position}</Text>
					</View>
					<View style={styles.metaItem}>
						<Text style={styles.metaLabel}>
							{strings.join.estimatedWaitLabel}
						</Text>
						<Text style={styles.metaValue}>
							{formatWaitEstimate(display.estimatedWaitMinutes)}
						</Text>
					</View>
				</View>

				<Pressable
					accessibilityRole="button"
					onPress={() => {
						router.push(`/ticket/${ticket.orgId}/${ticket.id}`);
					}}
					style={styles.primaryButton}
				>
					<Text style={styles.primaryLabel}>{strings.join.trackButton}</Text>
				</Pressable>
			</ScrollView>
		);
	}

	// Stage 2 — optional details + join. QUEUE_FULL shows the mapped copy and no
	// ticket (R2.5); any other error shows the code-mapped message (R10.2).
	const queueFull = isQueueFullError(mutation.error);
	const otherError =
		mutation.isError && !queueFull && mutation.error
			? getErrorMessage(mutation.error.code)
			: null;

	const handleJoin = (): void => {
		if (serviceId === null || gate.disabled) {
			return;
		}
		mutation.mutate(
			{ serviceId, customerName: name, customerPhone: phone },
			{ onSuccess: () => setStage("result") },
		);
	};

	return (
		<ScrollView contentContainerStyle={styles.container}>
			<View style={styles.header}>
				{organizationName ? (
					<Text style={styles.orgName}>{organizationName}</Text>
				) : null}
				<Text style={styles.title}>{strings.join.detailsTitle}</Text>
				<Text style={styles.subtitle}>{strings.join.detailsSubtitle}</Text>
				{selectedService ? (
					<Text style={styles.selectedService}>{selectedService.name}</Text>
				) : null}
			</View>

			<View style={styles.field}>
				<Text style={styles.fieldLabel}>{strings.join.fields.name}</Text>
				<TextInput
					accessibilityLabel={strings.join.fields.name}
					autoCapitalize="words"
					editable={!mutation.isPending}
					onChangeText={setName}
					placeholder={strings.join.fields.namePlaceholder}
					style={styles.input}
					value={name}
				/>
			</View>

			<View style={styles.field}>
				<Text style={styles.fieldLabel}>{strings.join.fields.phone}</Text>
				<TextInput
					accessibilityLabel={strings.join.fields.phone}
					editable={!mutation.isPending}
					keyboardType="phone-pad"
					onChangeText={setPhone}
					placeholder={strings.join.fields.phonePlaceholder}
					style={styles.input}
					value={phone}
				/>
			</View>

			{queueFull ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={styles.errorBanner}
				>
					<Text style={styles.errorTitle}>{strings.join.queueFullTitle}</Text>
					<Text style={styles.errorBody}>{strings.join.queueFullBody}</Text>
				</View>
			) : null}

			{otherError ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={styles.errorBanner}
				>
					<Text style={styles.errorBody}>{otherError}</Text>
				</View>
			) : null}

			<Pressable
				accessibilityRole="button"
				accessibilityState={{
					disabled: gate.disabled,
					busy: mutation.isPending,
				}}
				disabled={gate.disabled}
				onPress={handleJoin}
				style={[
					styles.primaryButton,
					gate.disabled && styles.primaryButtonDisabled,
				]}
			>
				<Text style={styles.primaryLabel}>
					{mutation.isPending
						? strings.join.joinPending
						: strings.join.joinButton}
				</Text>
			</Pressable>

			{gate.reason ? (
				<Text style={styles.offlineReason}>{gate.reason}</Text>
			) : null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flexGrow: 1,
		padding: 24,
		gap: 20,
	},
	header: {
		gap: 6,
	},
	orgName: {
		fontSize: 14,
		fontWeight: "600",
		color: "#2563eb",
	},
	title: {
		fontSize: 22,
		fontWeight: "700",
	},
	subtitle: {
		fontSize: 14,
		opacity: 0.7,
	},
	selectedService: {
		fontSize: 15,
		fontWeight: "600",
		marginTop: 4,
	},
	field: {
		gap: 6,
	},
	fieldLabel: {
		fontSize: 14,
		fontWeight: "600",
	},
	input: {
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 10,
		paddingHorizontal: 16,
		paddingVertical: 14,
		fontSize: 16,
	},
	errorBanner: {
		backgroundColor: "#fef2f2",
		borderColor: "#fecaca",
		borderWidth: 1,
		borderRadius: 10,
		padding: 16,
		gap: 4,
	},
	errorTitle: {
		fontSize: 16,
		fontWeight: "700",
		color: "#b91c1c",
	},
	errorBody: {
		fontSize: 14,
		color: "#b91c1c",
	},
	primaryButton: {
		paddingVertical: 16,
		borderRadius: 10,
		backgroundColor: "#2563eb",
		alignItems: "center",
	},
	primaryButtonDisabled: {
		opacity: 0.4,
	},
	primaryLabel: {
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
	resultHeader: {
		gap: 6,
	},
	resultTitle: {
		fontSize: 24,
		fontWeight: "700",
	},
	ticketCard: {
		alignItems: "center",
		gap: 8,
		paddingVertical: 28,
		borderRadius: 14,
		backgroundColor: "#eff6ff",
	},
	ticketNumberLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: "#2563eb",
	},
	ticketNumber: {
		fontSize: 48,
		fontWeight: "800",
		color: "#1d4ed8",
	},
	metaRow: {
		flexDirection: "row",
		gap: 16,
	},
	metaItem: {
		flex: 1,
		gap: 4,
		padding: 16,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#e2e8f0",
	},
	metaLabel: {
		fontSize: 13,
		opacity: 0.6,
	},
	metaValue: {
		fontSize: 20,
		fontWeight: "700",
	},
});
