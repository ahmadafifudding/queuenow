import { HistoryScreen } from "@/features/history";

/**
 * Ticket history (R7). Thin route: delegates to the history feature's
 * {@link HistoryScreen}, which gates on the session (account prompt when signed
 * out, R7.4) and renders the signed-in customer's history most-recent-first.
 */
export default function HistoryRoute(): React.JSX.Element {
	return <HistoryScreen />;
}
