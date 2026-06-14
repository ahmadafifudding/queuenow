import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { DataRegion } from "@/components/DataRegion";
import { strings } from "@/i18n";
import { getErrorMessage } from "@/lib/api/error-map";

import { useDiscovery } from "../use-discovery";
import type { DiscoveryServiceSummary, DiscoveryTarget } from "../types";

/**
 * Props for {@link ServiceSelection}. The route supplies the discovery target
 * (org identifier + optional scanned service). `onJoin` is the seam for the join
 * action itself, which is implemented in task 8.1 — this screen resolves the org
 * and renders the selection UI up to the point of joining.
 */
export interface ServiceSelectionProps {
	/** The discovery target resolved from the route params. */
	target: DiscoveryTarget;
	/**
	 * Invoked with the chosen service id when the customer confirms joining.
	 * Wired by task 8.1 (join request + result); when omitted the join action is
	 * presented but inert (discovery scope only).
	 */
	onJoin?: (serviceId: string) => void;
}

/**
 * Service selection + join-availability UI (R1.1, R1.3, R1.4, R1.5).
 *
 * Resolves the org's active services via {@link useDiscovery} and renders
 * DataRegion-style loading / error / empty states with centralized copy. On
 * success it shows the organization name and its active services:
 *  - a single active service is preselected automatically,
 *  - more than one active service requires explicit selection before joining
 *    (R1.4),
 *  - an `ORG_NOT_FOUND` / `ORG_INACTIVE` (or any other) error shows an error and
 *    presents NO join action (R1.3).
 */
export function ServiceSelection({
	target,
	onJoin,
}: ServiceSelectionProps): React.JSX.Element {
	const { organizationName, isLoading, isError, decision, refetch } =
		useDiscovery(target);
	const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
		null,
	);

	// Adopt the preselected (single) service whenever the decision settles.
	useEffect(() => {
		if (decision?.preselectedServiceId) {
			setSelectedServiceId(decision.preselectedServiceId);
		}
	}, [decision?.preselectedServiceId]);

	const errorText = useMemo(
		() =>
			decision?.errorCode
				? getErrorMessage(decision.errorCode)
				: strings.discovery.loadError,
		[decision?.errorCode],
	);

	const showError = isError || (decision?.showError ?? false);
	const isEmpty = decision?.isEmpty ?? false;

	return (
		<DataRegion
			isLoading={isLoading || decision === null}
			isError={showError}
			isEmpty={isEmpty}
			loadingText={strings.discovery.resolving}
			errorText={errorText}
			emptyText={strings.discovery.noServices}
			onRetry={refetch}
		>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.header}>
					{organizationName ? (
						<Text style={styles.orgName}>{organizationName}</Text>
					) : null}
					<Text style={styles.title}>{strings.join.selectServiceTitle}</Text>
					{decision?.requiresServiceSelection ? (
						<Text style={styles.subtitle}>
							{strings.join.selectServiceSubtitle}
						</Text>
					) : null}
				</View>

				<View style={styles.list}>
					{(decision?.services ?? []).map((service) => (
						<ServiceRow
							key={service.id}
							service={service}
							selected={service.id === selectedServiceId}
							onSelect={() => setSelectedServiceId(service.id)}
						/>
					))}
				</View>

				{decision?.presentJoinAction ? (
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ disabled: selectedServiceId === null }}
						disabled={selectedServiceId === null}
						onPress={() => {
							if (selectedServiceId !== null) {
								onJoin?.(selectedServiceId);
							}
						}}
						style={[
							styles.joinButton,
							selectedServiceId === null && styles.joinButtonDisabled,
						]}
					>
						<Text style={styles.joinLabel}>{strings.join.joinButton}</Text>
					</Pressable>
				) : null}
			</ScrollView>
		</DataRegion>
	);
}

interface ServiceRowProps {
	service: DiscoveryServiceSummary;
	selected: boolean;
	onSelect: () => void;
}

/** A single selectable active service row. */
function ServiceRow({
	service,
	selected,
	onSelect,
}: ServiceRowProps): React.JSX.Element {
	const waitLabel = `${strings.join.estimatedWaitLabel}: ~${service.estimatedWaitMinutes} ${strings.common.minutesSuffix}`;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			onPress={onSelect}
			style={[styles.row, selected && styles.rowSelected]}
		>
			<View style={styles.rowMain}>
				<Text style={styles.serviceName}>{service.name}</Text>
				<Text style={styles.serviceMeta}>{waitLabel}</Text>
			</View>
			<Text style={styles.servicePrefix}>{service.prefix}</Text>
		</Pressable>
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
	list: {
		gap: 12,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 10,
		paddingHorizontal: 16,
		paddingVertical: 14,
	},
	rowSelected: {
		borderColor: "#2563eb",
		backgroundColor: "#eff6ff",
	},
	rowMain: {
		flex: 1,
		gap: 4,
	},
	serviceName: {
		fontSize: 16,
		fontWeight: "600",
	},
	serviceMeta: {
		fontSize: 13,
		opacity: 0.6,
	},
	servicePrefix: {
		fontSize: 16,
		fontWeight: "700",
		color: "#64748b",
		marginLeft: 12,
	},
	joinButton: {
		paddingVertical: 16,
		borderRadius: 10,
		backgroundColor: "#2563eb",
		alignItems: "center",
	},
	joinButtonDisabled: {
		opacity: 0.4,
	},
	joinLabel: {
		color: "#ffffff",
		fontSize: 16,
		fontWeight: "600",
	},
});
