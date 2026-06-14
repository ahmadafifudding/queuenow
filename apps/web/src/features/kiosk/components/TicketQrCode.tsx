/*
 * TicketQrCode — renders a scannable QR code for the ticket tracking URL (R12.5).
 *
 * Uses the `qrcode` package's browser build to render an inline SVG string
 * (crisp at any size, no canvas/raster). Generation is async, so we render a
 * lightweight placeholder while encoding and a small fallback message if it
 * fails — the ticket number itself is always shown by the parent, so a missing
 * QR never blocks the customer.
 */
import { useEffect, useState, type ReactElement } from "react";
import * as QRCode from "qrcode";

import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

/** Props for {@link TicketQrCode}. */
export interface TicketQrCodeProps {
	/** The absolute URL to encode (the phone-tracking link, R12.5). */
	value: string;
	/** Rendered width/height in pixels. Defaults to 220. */
	size?: number;
	/** Extra classes for the wrapper. */
	className?: string;
}

/** Async-generated state of the QR SVG. */
type QrState =
	| { status: "loading" }
	| { status: "ready"; svg: string }
	| { status: "error" };

/**
 * Render a QR code that links to the ticket tracking page.
 *
 * @param props - the value to encode plus presentation options.
 */
export function TicketQrCode({
	value,
	size = 220,
	className,
}: TicketQrCodeProps): ReactElement {
	const [state, setState] = useState<QrState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });

		QRCode.toString(value, { type: "svg", margin: 1, width: size })
			.then((svg) => {
				if (!cancelled) {
					setState({ status: "ready", svg });
				}
			})
			.catch(() => {
				if (!cancelled) {
					setState({ status: "error" });
				}
			});

		return () => {
			cancelled = true;
		};
	}, [value, size]);

	if (state.status === "error") {
		return (
			<p
				className={cn("text-sm text-muted-foreground", className)}
				role="status"
			>
				{strings.kiosk.qrUnavailable}
			</p>
		);
	}

	if (state.status === "loading") {
		return (
			<div
				className={cn("animate-pulse rounded-lg bg-muted", className)}
				style={{ width: size, height: size }}
				aria-hidden="true"
			/>
		);
	}

	return (
		<div
			className={cn("overflow-hidden rounded-lg bg-white p-2", className)}
			style={{ width: size, height: size }}
			role="img"
			aria-label={strings.kiosk.scanToTrack}
			// The SVG is produced locally by the `qrcode` library from a URL we built
			// ourselves (no user/network HTML), so inlining it is safe here.
			dangerouslySetInnerHTML={{ __html: state.svg }}
		/>
	);
}
