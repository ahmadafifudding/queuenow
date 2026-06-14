/*
 * ServicesList — presentational table of an org's services (R8.1).
 *
 * Renders each service's name, prefix, active state, and sort order, plus
 * per-row edit and activate/deactivate controls. Fully controlled: it receives
 * the services and reports edit/toggle intents upward, so it stays free of
 * query/mutation coupling and is easy to test. The active state is conveyed by
 * a text label (not color alone) for accessibility (R13.3).
 */
import type { ReactElement } from "react";
import type { IService } from "@queuenow/shared-types";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { strings } from "@/i18n";

/** Props for {@link ServicesList}. */
export interface ServicesListProps {
	/** The services to display (already sorted by the caller if desired). */
	services: IService[];
	/** Called when the user wants to edit a service. */
	onEdit: (service: IService) => void;
	/** Called when the user toggles a service's active state. */
	onToggle: (service: IService) => void;
	/** Id of the service whose toggle is currently in flight, if any. */
	togglingId?: string | null;
}

/**
 * A table listing services with edit and activate/deactivate actions.
 */
export function ServicesList({
	services,
	onEdit,
	onToggle,
	togglingId = null,
}: ServicesListProps): ReactElement {
	const copy = strings.services;

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead className="border-b border-border bg-muted/40 text-left">
					<tr>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.columns.name}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.columns.prefix}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.columns.active}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.columns.sortOrder}
						</th>
						<th scope="col" className="px-4 py-2 text-right font-medium">
							{copy.columns.actions}
						</th>
					</tr>
				</thead>
				<tbody>
					{services.map((service) => {
						const isToggling = togglingId === service.id;
						return (
							<tr
								key={service.id}
								className="border-b border-border last:border-0"
							>
								<td className="px-4 py-2 font-medium">{service.name}</td>
								<td className="px-4 py-2 tabular-nums text-muted-foreground">
									{service.prefix}
								</td>
								<td className="px-4 py-2">
									<span
										className={cn(
											"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
											service.isActive
												? "bg-primary/10 text-primary"
												: "bg-muted text-muted-foreground",
										)}
									>
										{service.isActive ? copy.activeLabel : copy.inactiveLabel}
									</span>
								</td>
								<td className="px-4 py-2 tabular-nums">{service.sortOrder}</td>
								<td className="px-4 py-2">
									<div className="flex items-center justify-end gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onEdit(service)}
										>
											{copy.actions.edit}
										</Button>
										<Button
											type="button"
											variant={service.isActive ? "ghost" : "default"}
											size="sm"
											disabled={isToggling}
											onClick={() => onToggle(service)}
										>
											{isToggling
												? copy.actions.togglePending
												: service.isActive
													? copy.actions.deactivate
													: copy.actions.activate}
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
