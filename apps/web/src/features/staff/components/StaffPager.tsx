/*
 * StaffPager — previous/next pagination control wired to the route search
 * params (R10.2).
 *
 * Presentational: it reports the desired page via `onPageChange` and the parent
 * route writes it into the URL search params, so the page is shareable and
 * back-button friendly. Buttons disable at the first/last page and while a page
 * change is in flight, and the current position is announced via `aria-live`.
 */
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { strings } from "@/i18n";

/** Props for {@link StaffPager}. */
export interface StaffPagerProps {
	/** The 1-indexed current page. */
	page: number;
	/** Total number of pages (`>= 1`). */
	totalPages: number;
	/** Request a move to `nextPage`. The parent updates the URL search params. */
	onPageChange: (nextPage: number) => void;
	/** Disable controls while data is loading/fetching. */
	disabled?: boolean;
}

/** Render previous/next controls plus a "Page X of Y" status. */
export function StaffPager({
	page,
	totalPages,
	onPageChange,
	disabled = false,
}: StaffPagerProps): ReactElement {
	const copy = strings.staff.pager;

	const atFirst = page <= 1;
	const atLast = page >= totalPages;

	const statusText = copy.status
		.replace("{page}", String(page))
		.replace("{total}", String(totalPages));

	return (
		<nav
			className="flex items-center justify-between gap-4 pt-4"
			aria-label={strings.staff.title}
		>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onPageChange(page - 1)}
				disabled={disabled || atFirst}
			>
				{copy.previous}
			</Button>

			<span className="text-sm text-muted-foreground" aria-live="polite">
				{statusText}
			</span>

			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onPageChange(page + 1)}
				disabled={disabled || atLast}
			>
				{copy.next}
			</Button>
		</nav>
	);
}
