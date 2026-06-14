/*
 * StaffTable — presentational table of staff rows (R10.1).
 *
 * Renders name, email, role, and invitation status for each member. Purely
 * presentational: it takes already-normalized `StaffMember[]` and renders
 * semantic table markup (a real `<table>` with a caption and column headers) so
 * the list is keyboard- and screen-reader-friendly. Loading / empty / error
 * states are owned by the parent via `<DataRegion>`.
 */
import type { ReactElement } from "react";

import { strings } from "@/i18n";

import type { StaffMember } from "../types";

/** Props for {@link StaffTable}. */
export interface StaffTableProps {
	/** The staff rows for the current page. */
	members: StaffMember[];
}

/** A small status pill that does not rely on color alone (text label included). */
function StatusBadge({ member }: { member: StaffMember }): ReactElement {
	const copy = strings.staff;
	return (
		<span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium">
			{copy.status[member.invitationStatus]}
		</span>
	);
}

/** Render the staff list as a semantic, accessible table. */
export function StaffTable({ members }: StaffTableProps): ReactElement {
	const copy = strings.staff;

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full border-collapse text-sm">
				<caption className="sr-only">{copy.list.caption}</caption>
				<thead>
					<tr className="border-b border-border bg-muted/30 text-left">
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.list.colName}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.list.colEmail}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.list.colRole}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{copy.list.colStatus}
						</th>
					</tr>
				</thead>
				<tbody>
					{members.map((member) => (
						<tr
							key={member.id}
							className="border-b border-border last:border-b-0"
						>
							<td className="px-4 py-2">
								{member.name && member.name.length > 0 ? (
									member.name
								) : (
									<span className="text-muted-foreground">
										{copy.list.unnamed}
									</span>
								)}
							</td>
							<td className="px-4 py-2">{member.email}</td>
							<td className="px-4 py-2">{copy.roles[member.role]}</td>
							<td className="px-4 py-2">
								<StatusBadge member={member} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
