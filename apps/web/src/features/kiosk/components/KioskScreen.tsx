/*
 * KioskScreen — the public, on-site ticket-taking flow (R12).
 *
 * Orchestrates a small three-step state machine, code-split out of the
 * dashboard bundle by the lazy `/kiosk/:orgId` route (R1.8):
 *
 *   select  → pick an active service (R12.2, touch targets R12.8)
 *   details → provide any settings-required fields, then confirm (R12.3, R12.4)
 *   ticket  → see the assigned number + a tracking QR code (R12.4, R12.5)
 *
 * It is fully unauthenticated (R12.1): the token-less API_Client reads active
 * services + public queue settings and posts the join. A `QUEUE_FULL` error is
 * surfaced as a "queue is full" message (R12.6); any other failure is toasted
 * from its error code (never a raw backend message). After a period of
 * inactivity the screen resets to `select` so the next customer starts clean
 * (R12.7).
 */
import { useCallback, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { ERROR_CODES } from "@queuenow/shared-constants";
import type { JoinQueueInput } from "@queuenow/shared-validation";

import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useActiveServices } from "../api/useActiveServices";
import { useJoinQueue } from "../api/useJoinQueue";
import {
	DEFAULT_KIOSK_SETTINGS,
	useQueueSettings,
} from "../api/useQueueSettings";
import { useIdleReset } from "../hooks/useIdleReset";
import type { KioskJoinedTicket, KioskService } from "../types";
import { JoinForm } from "./JoinForm";
import { ServiceSelection } from "./ServiceSelection";
import { TicketResult } from "./TicketResult";

/** Props for {@link KioskScreen}. */
export interface KioskScreenProps {
	/** The organization to take a ticket for (from the route `orgId` param). */
	orgId: string;
}

/** The current step of the kiosk flow. */
type KioskStep =
	| { kind: "select" }
	| { kind: "details"; service: KioskService }
	| { kind: "ticket"; ticket: KioskJoinedTicket };

/**
 * The public Kiosk screen.
 *
 * @param props - the org id from the route.
 */
export function KioskScreen({ orgId }: KioskScreenProps): ReactElement {
	const [step, setStep] = useState<KioskStep>({ kind: "select" });
	const [isQueueFull, setIsQueueFull] = useState<boolean>(false);

	const servicesQuery = useActiveServices(orgId);
	const settingsQuery = useQueueSettings(orgId);
	const join = useJoinQueue(orgId);

	const settings = settingsQuery.data ?? DEFAULT_KIOSK_SETTINGS;

	// Reset to the start screen after inactivity — but only once the customer has
	// moved past the start screen (nothing to reset while already on `select`).
	const resetToStart = useCallback(() => {
		setStep({ kind: "select" });
		setIsQueueFull(false);
		join.reset();
	}, [join]);

	useIdleReset({ onIdle: resetToStart, enabled: step.kind !== "select" });

	const handleSelect = useCallback((service: KioskService) => {
		setIsQueueFull(false);
		setStep({ kind: "details", service });
	}, []);

	const handleBack = useCallback(() => {
		setIsQueueFull(false);
		setStep({ kind: "select" });
	}, []);

	const handleConfirm = useCallback(
		(values: JoinQueueInput) => {
			setIsQueueFull(false);
			join.mutate(values, {
				onSuccess: (ticket) => {
					setStep({ kind: "ticket", ticket });
				},
				onError: (error) => {
					if (error.code === ERROR_CODES.QUEUE_FULL) {
						// Distinct, expected outcome — show the dedicated message (R12.6).
						setIsQueueFull(true);
						return;
					}
					toast.error(getErrorMessage(error));
				},
			});
		},
		[join],
	);

	return (
		<main className="flex min-h-screen flex-col bg-background text-foreground">
			<header className="border-b border-border px-6 py-5 text-center sm:px-10">
				<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
					{strings.kiosk.title}
				</h1>
			</header>

			<div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
				{step.kind === "select" ? (
					<ServiceSelection
						services={servicesQuery.data}
						isLoading={servicesQuery.isLoading}
						isError={servicesQuery.isError}
						error={servicesQuery.error}
						onRetry={() => {
							void servicesQuery.refetch();
						}}
						onSelect={handleSelect}
					/>
				) : null}

				{step.kind === "details" ? (
					<JoinForm
						service={step.service}
						settings={settings}
						onSubmit={handleConfirm}
						isPending={join.isPending}
						isQueueFull={isQueueFull}
						onBack={handleBack}
					/>
				) : null}

				{step.kind === "ticket" ? (
					<TicketResult
						orgId={orgId}
						ticket={step.ticket}
						onDone={resetToStart}
					/>
				) : null}
			</div>
		</main>
	);
}
