/*
 * ServiceSelection — the Kiosk start screen presenting the org's active
 * services as large, touch-friendly tiles (R12.2, R12.8).
 *
 * Read-only and public: it just renders the loaded services and reports the
 * chosen one upward. Loading/empty/error states go through the shared
 * `<DataRegion>`; the error copy is mapped from the error code, never raw.
 */
import type { ReactElement } from "react";

import { DataRegion } from "@/components/DataRegion";
import { Button } from "@/components/ui/button";
import { type ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import type { KioskService } from "../types";

/** Props for {@link ServiceSelection}. */
export interface ServiceSelectionProps {
	/** The loaded active services (when available). */
	services: KioskService[] | undefined;
	/** Whether the services query is loading. */
	isLoading: boolean;
	/** Whether the services query errored. */
	isError: boolean;
	/** The error, used to map a friendly message. */
	error: ApiError | null;
	/** Retry the services query. */
	onRetry: () => void;
	/** Called with the service the customer tapped. */
	onSelect: (service: KioskService) => void;
}

/**
 * The service-selection start screen.
 *
 * @param props - services data plus selection/retry callbacks.
 */
export function ServiceSelection({
	services,
	isLoading,
	isError,
	error,
	onRetry,
	onSelect,
}: ServiceSelectionProps): ReactElement {
	return (
		<section
			className="flex w-full max-w-3xl flex-col gap-8"
			aria-labelledby="kiosk-select-heading"
		>
			<header className="text-center">
				<h2
					id="kiosk-select-heading"
					className="text-3xl font-bold sm:text-4xl"
				>
					{strings.kiosk.selectServiceTitle}
				</h2>
				<p className="mt-2 text-lg text-muted-foreground">
					{strings.kiosk.subtitle}
				</p>
			</header>

			<DataRegion<KioskService[]>
				isLoading={isLoading}
				isError={isError}
				error={error}
				data={services}
				isEmpty={(services?.length ?? 0) === 0}
				onRetry={onRetry}
				emptyMessage={strings.kiosk.noServices}
				errorMessage={getErrorMessage(error)}
				renderError={(_err, retry) => (
					<div
						role="alert"
						className="flex flex-col items-center gap-4 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
					>
						<p className="text-lg text-destructive">
							{strings.kiosk.servicesError}
						</p>
						{retry ? (
							<Button size="lg" variant="outline" onClick={retry}>
								{strings.common.retry}
							</Button>
						) : null}
					</div>
				)}
				renderEmpty={() => (
					<p className="rounded-xl border border-dashed border-border p-10 text-center text-lg text-muted-foreground">
						{strings.kiosk.noServices}
					</p>
				)}
			>
				{(loaded) => (
					<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{loaded.map((service) => (
							<li key={service.id}>
								{/*
								 * Large touch target (R12.8): full-width tile, min-height well
								 * above the 44px touch guideline, generous padding.
								 */}
								<button
									type="button"
									onClick={() => onSelect(service)}
									className="flex min-h-28 w-full items-center gap-4 rounded-2xl border-2 border-border bg-card p-6 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								>
									<span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl font-black text-primary-foreground">
										{service.prefix}
									</span>
									<span className="text-2xl font-semibold">{service.name}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</DataRegion>
		</section>
	);
}
