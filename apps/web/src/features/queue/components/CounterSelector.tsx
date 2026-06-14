/*
 * CounterSelector — pick the active counter before serving (R6.2).
 *
 * Presentational and fully controlled: it receives the list of active counters
 * and the current selection, and reports changes upward. The parent
 * (`QueueStatusView`) owns the ephemeral selection via the counter-selection
 * store, keeping this component free of store/query coupling and easy to test.
 *
 * Built on a native `<select>` paired with a `<Label>` via `htmlFor`/`id`, so it
 * is keyboard-reachable and screen-reader friendly out of the box (R13.1, R13.2)
 * without pulling in a heavier primitive.
 */
import { useId } from "react";
import type { ICounter } from "@queuenow/shared-types";

import { Label } from "@/components/ui/label";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

/** Props for {@link CounterSelector}. */
export interface CounterSelectorProps {
	/** Active counters the staff member can choose from. */
	counters: ICounter[];
	/** The currently selected counter id, or `null` when none is selected. */
	value: string | null;
	/** Called with the newly selected counter id, or `null` when cleared. */
	onChange: (counterId: string | null) => void;
	/** Disable the control (e.g. while counters load). Defaults to `false`. */
	disabled?: boolean;
	/** Extra classes for the wrapper. */
	className?: string;
}

/**
 * A labelled counter picker. Renders a placeholder option when nothing is
 * selected and a friendly empty message when there are no active counters.
 */
export function CounterSelector({
	counters,
	value,
	onChange,
	disabled = false,
	className,
}: CounterSelectorProps): React.ReactElement {
	const selectId = useId();
	const copy = strings.queue;
	const hasCounters = counters.length > 0;

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<Label htmlFor={selectId}>{copy.counterLabel}</Label>
			{hasCounters ? (
				<select
					id={selectId}
					value={value ?? ""}
					disabled={disabled}
					onChange={(event) => {
						const next = event.target.value;
						onChange(next === "" ? null : next);
					}}
					className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<option value="">{copy.counterPlaceholder}</option>
					{counters.map((counter) => (
						<option key={counter.id} value={counter.id}>
							{counter.name}
						</option>
					))}
				</select>
			) : (
				<p className="text-sm text-muted-foreground">{copy.noCounters}</p>
			)}
		</div>
	);
}
