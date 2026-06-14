/*
 * CounterList — presentational list of counters (R9.1, R9.4).
 *
 * Renders each counter's name, its associated service name, and an active/
 * inactive badge that does not rely on color alone (it carries text). Each row
 * exposes an Edit action and an Activate/Deactivate toggle; both are reported
 * upward so this component stays free of query/mutation coupling and easy to
 * test. The parent owns the toggle mutation and passes `togglingId` so the row
 * acted on shows a pending state.
 */
import type { ReactElement } from "react";
import type { ICounter } from "@queuenow/shared-types";

import { Button } from "@/components/ui/button";
import { strings } from "@/i18n";

/** Props for {@link CounterList}. */
export interface CounterListProps {
	/** The counters to render. */
	counters: ICounter[];
	/** Resolve a serviceId to its display name. */
	serviceNameFor: (serviceId: string) => string;
	/** Open the edit form for a counter. */
	onEdit: (counter: ICounter) => void;
	/** Toggle a counter's active state to `nextActive`. */
	onToggle: (counter: ICounter, nextActive: boolean) => void;
	/** The id of the counter whose toggle is currently in flight, if any. */
	togglingId?: string | null;
}

/**
 * A simple, accessible table of counters with edit + active-toggle controls.
 */
export function CounterList({
	counters,
	serviceNameFor,
	onEdit,
	onToggle,
	togglingId = null,
}: CounterListProps): ReactElement {
	const copy = strings.counters;

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
						<th scope="col" className="px-4 py-3 font-medium">
							{copy.nameLabel}
						</th>
						<th scope="col" className="px-4 py-3 font-medium">
							{copy.serviceLabel}
						</th>
						<th scope="col" className="px-4 py-3 font-medium">
							{copy.statusLabel}
						</th>
						<th scope="col" className="px-4 py-3 text-right font-medium">
							{copy.actionsLabel}
						</th>
					</tr>
				</thead>
				<tbody>
					{counters.map((counter) => {
						const isToggling = togglingId === counter.id;
						return (
							<tr
								key={counter.id}
								className="border-b border-border last:border-0"
							>
								<td className="px-4 py-3 font-medium">{counter.name}</td>
								<td className="px-4 py-3 text-muted-foreground">
									{serviceNameFor(counter.serviceId)}
								</td>
								<td className="px-4 py-3">
									<span
										className={
											counter.isActive
												? "inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
												: "inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
										}
									>
										{counter.isActive ? copy.active : copy.inactive}
									</span>
								</td>
								<td className="px-4 py-3">
									<div className="flex items-center justify-end gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onEdit(counter)}
										>
											{copy.edit}
										</Button>
										<Button
											type="button"
											variant={counter.isActive ? "ghost" : "default"}
											size="sm"
											disabled={isToggling}
											onClick={() => onToggle(counter, !counter.isActive)}
										>
											{counter.isActive ? copy.deactivate : copy.activate}
										</Button>
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
