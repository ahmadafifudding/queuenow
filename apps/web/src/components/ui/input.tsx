import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal, self-contained Input mirroring the shadcn/ui `Input` API (a styled
 * `input` accepting `className`) so it can be swapped for the registry component
 * later without changing call sites. Surfaces an invalid state via
 * `aria-invalid` styling so field errors are conveyed by more than color.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{ className, type = "text", ...props },
	ref,
) {
	return (
		<input
			ref={ref}
			type={type}
			className={cn(
				"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
				className,
			)}
			{...props}
		/>
	);
});
