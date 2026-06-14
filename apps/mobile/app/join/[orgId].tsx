import { useLocalSearchParams } from "expo-router";

import type { DiscoveryTarget } from "@/features/discovery";
import { JoinFlow } from "@/features/queue";

/**
 * Service selection + join (R1.4, R1.5, R2). Thin route: builds the discovery
 * target from the route params and delegates to the queue feature's
 * {@link JoinFlow}, which resolves the org's active services, collects the
 * optional contact details, joins the queue, and shows the ticket result.
 *
 * `orgId` is the org identifier carried from the deep link / manual code (see
 * the slug→orgId resolution note in `parse-discovery-url.ts`); `service` is the
 * optional service id from a service-specific QR; `source` distinguishes a
 * scanned target from a manually entered one.
 */
export default function JoinScreen(): React.JSX.Element {
	const { orgId, service, source } = useLocalSearchParams<{
		orgId: string;
		service?: string;
		source?: string;
	}>();

	const target: DiscoveryTarget = {
		slug: orgId,
		serviceId: service,
		source: source === "qr" ? "qr" : "manual",
	};

	return <JoinFlow target={target} />;
}
