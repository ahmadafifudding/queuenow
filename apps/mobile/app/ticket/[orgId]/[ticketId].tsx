import { useLocalSearchParams } from "expo-router";

import { TicketTracker } from "@/features/queue";

// Active-ticket tracking. See R3, R4, R5, R9, R11.
// Thin route: resolve the params and delegate to the feature component.
export default function TicketScreen(): React.JSX.Element {
	const { orgId, ticketId } = useLocalSearchParams<{
		orgId: string;
		ticketId: string;
	}>();
	return <TicketTracker orgId={orgId} ticketId={ticketId} />;
}
