/**
 * OrganizationSettingsView — the Phase 3 organization settings page (R11).
 *
 * Composition:
 * - Loads the org details (+ branding) and queue settings through the feature's
 *   query hooks, each wrapped in `<DataRegion>` for explicit loading/error/empty
 *   states (R11 data region).
 * - When the organization loads, applies `branding.primaryColor` to the theme so
 *   the page reflects the org's brand color at runtime (R11.3).
 * - Renders the three forms — details (R11.1), branding (R11.2), and queue
 *   settings (R11.6) — plus the OWNER-only delete control (R11.7).
 *
 * The active `orgId` comes from the in-memory Auth_Store (`organization.id`),
 * set from the login/refresh response.
 */
import { useEffect, type ReactElement } from "react";

import { DataRegion } from "@/components/DataRegion";
import { useAuthStore } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { applyBranding } from "@/lib/theme";
import { strings } from "@/i18n";

import { useOrganization } from "../api/useOrganization";
import { useQueueSettings } from "../api/useQueueSettings";
import { BrandingForm } from "./BrandingForm";
import { DeleteOrganizationControl } from "./DeleteOrganizationControl";
import { OrganizationDetailsForm } from "./OrganizationDetailsForm";
import { QueueSettingsForm } from "./QueueSettingsForm";

export function OrganizationSettingsView(): ReactElement {
	const copy = strings.organization;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const orgQuery = useOrganization({
		orgId: orgId ?? "",
		enabled: orgId !== null,
	});
	const settingsQuery = useQueueSettings({
		orgId: orgId ?? "",
		enabled: orgId !== null,
	});

	// Apply the org's brand color once it loads (R11.3). Reacts to the resolved
	// primaryColor so a saved change also re-themes the page on refetch.
	const primaryColor = orgQuery.data?.branding?.primaryColor;
	useEffect(() => {
		if (primaryColor) {
			applyBranding(primaryColor);
		}
	}, [primaryColor]);

	if (orgId === null) {
		return (
			<main className="mx-auto max-w-3xl p-8">
				<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
				<p className="mt-2 text-muted-foreground">{copy.noOrganization}</p>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-3xl space-y-8 p-8">
			<header className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
				<p className="text-muted-foreground">{copy.subtitle}</p>
			</header>

			<DataRegion
				isLoading={orgQuery.isLoading}
				isError={orgQuery.isError}
				error={orgQuery.error}
				data={orgQuery.data}
				errorMessage={getErrorMessage(orgQuery.error)}
				onRetry={() => void orgQuery.refetch()}
			>
				{(organization) => (
					<div className="space-y-8">
						<OrganizationDetailsForm organization={organization} />
						<BrandingForm
							orgId={organization.id}
							branding={organization.branding}
						/>
						<DeleteOrganizationControl
							orgId={organization.id}
							organizationName={organization.name}
						/>
					</div>
				)}
			</DataRegion>

			<DataRegion
				isLoading={settingsQuery.isLoading}
				isError={settingsQuery.isError}
				error={settingsQuery.error}
				data={settingsQuery.data}
				errorMessage={getErrorMessage(settingsQuery.error)}
				onRetry={() => void settingsQuery.refetch()}
			>
				{(settings) => <QueueSettingsForm orgId={orgId} settings={settings} />}
			</DataRegion>
		</main>
	);
}
