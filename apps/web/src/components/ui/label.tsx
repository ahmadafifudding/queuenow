import { forwardRef } from "react";
import type { LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal, self-contained Label mirroring the shadcn/ui `Label` API (a styled
 * `label` accepting `className`). Use with the matching control's `id`/`htmlFor`
 * so the field stays keyboard- and screen-reader-accessible.
 */
export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
	{ className, ...props },
	ref,
) {
	return (
		<label
			ref={ref}
			className={cn(
				"text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
				className,
			)}
			{...props}
		/>
	);
});
