/*
 * ConnectionIndicator — a subtle, non-blocking "reconnecting" banner (R3.11).
 *
 * It subscribes to the Socket_Client status store (`useSocketStatus`) and
 * renders ONLY while the realtime connection is degraded (reconnecting or
 * dropped). When the socket is healthy (`connected`) or pre-connection
 * (`idle` / `connecting`) it renders nothing, so it never adds chrome during
 * normal operation.
 *
 * Accessibility / non-blocking contract:
 * - It is a polite live region — an `<output>` element (implicit
 *   `role="status"`) with `aria-live="polite"` — so assistive tech announces
 *   the state change without interrupting the user.
 * - It is NOT a modal/overlay: it is a small fixed banner that does not capture
 *   focus, does not trap interaction, and leaves the rest of the UI usable. The
 *   polling fallback keeps data fresh underneath it (Property 12), so the app —
 *   including the always-on Display — keeps working while reconnecting (R7.9).
 */
import type { ReactElement } from "react";

import { type SocketStatus, useSocketStatus } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { strings } from "@/i18n";

/** Statuses that represent a degraded connection worth surfacing to the user. */
function isDegraded(status: SocketStatus): boolean {
	return status === "reconnecting" || status === "disconnected";
}

/** Props for {@link ConnectionIndicator}. */
export interface ConnectionIndicatorProps {
	/** Optional extra classes for positioning/styling overrides. */
	className?: string;
}

/**
 * Render a non-blocking reconnecting banner while the realtime connection is
 * down; render nothing while healthy.
 */
export function ConnectionIndicator({
	className,
}: ConnectionIndicatorProps): ReactElement | null {
	const degraded = useSocketStatus((state) => isDegraded(state.status));

	if (!degraded) {
		return null;
	}

	return (
		<output
			aria-live="polite"
			className={cn(
				// Fixed, unobtrusive, and pointer-events-none so it never blocks
				// interaction with the content beneath it.
				"pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 py-2",
				className,
			)}
		>
			<span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-muted/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
				<span
					className="h-2 w-2 animate-pulse rounded-full bg-amber-500"
					aria-hidden="true"
				/>
				{strings.connection.reconnecting}
			</span>
		</output>
	);
}
