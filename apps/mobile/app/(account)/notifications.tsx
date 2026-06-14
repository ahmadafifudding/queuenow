import { NotificationsList } from "@/features/notifications";

/**
 * Persisted notifications list (R5.7). Thin route: delegates to the
 * notifications feature's {@link NotificationsList}, which shows the signed-in
 * customer's notifications in reverse chronological order and an account prompt
 * when signed out.
 */
export default function NotificationsScreen(): React.JSX.Element {
	return <NotificationsList />;
}
