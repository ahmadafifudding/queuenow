import type { ReactElement, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Query-like state accepted by {@link DataRegion}. Intentionally structural so
 * it maps cleanly onto a TanStack Query result without coupling to it.
 *
 * @typeParam TData - shape of the successfully loaded data.
 */
export interface DataRegionProps<TData> {
	/** Whether the region is currently loading its primary data. */
	isLoading: boolean;
	/** Whether loading the data failed. */
	isError?: boolean;
	/** The error that caused the failure, if any. Used by {@link renderError}. */
	error?: unknown;
	/**
	 * The loaded data. When omitted/`null`/`undefined` (and not loading or
	 * erroring) the empty state is shown — unless {@link isEmpty} overrides it.
	 */
	data?: TData | null;
	/**
	 * Explicit emptiness override. When provided it takes precedence over the
	 * `data`-presence heuristic (useful for empty arrays or paginated lists).
	 */
	isEmpty?: boolean;
	/**
	 * Success renderer. Receives the non-null `data`. Prefer this over `children`
	 * when the content depends on the loaded value.
	 */
	children?: ReactNode | ((data: TData) => ReactNode);
	/** Optional custom loading state. Defaults to an accessible skeleton block. */
	renderLoading?: () => ReactNode;
	/** Optional custom empty state. Defaults to a friendly message. */
	renderEmpty?: () => ReactNode;
	/**
	 * Optional custom error state. Receives the error and (when provided) the
	 * retry callback. Defaults to a friendly, role="alert" message + retry button.
	 */
	renderError?: (error: unknown, retry?: () => void) => ReactNode;
	/** Friendly empty-state message used by the default empty renderer. */
	emptyMessage?: string;
	/**
	 * Friendly error message used by the default error renderer. Callers should
	 * pass copy mapped from `error.code` (e.g. via `lib/api/error-map`); raw
	 * backend messages must never be surfaced here.
	 */
	errorMessage?: string;
	/** Retry callback wired into the default error state (e.g. `query.refetch`). */
	onRetry?: () => void;
	/** Accessible label for the loading region. */
	loadingLabel?: string;
	/** Extra classes applied to the wrapper element. */
	className?: string;
}

const DEFAULT_EMPTY_MESSAGE = "Nothing to show yet.";
const DEFAULT_ERROR_MESSAGE =
	"Something went wrong while loading this content.";
const DEFAULT_LOADING_LABEL = "Loading";

function resolveChildren<TData>(
	children: DataRegionProps<TData>["children"],
	data: TData,
): ReactNode {
	return typeof children === "function" ? children(data) : children;
}

/**
 * Generic, typed wrapper that renders explicit loading / empty / error / success
 * states for a single data region, so primary content is never a bare spinner.
 *
 * State precedence: loading → error → empty → success.
 *
 * shadcn/Radix children are rendered untouched in the success branch, preserving
 * their ARIA semantics. The default empty/error states are keyboard-reachable and
 * the error state is announced via `role="alert"`.
 */
export function DataRegion<TData>({
	isLoading,
	isError = false,
	error,
	data,
	isEmpty,
	children,
	renderLoading,
	renderEmpty,
	renderError,
	emptyMessage = DEFAULT_EMPTY_MESSAGE,
	errorMessage = DEFAULT_ERROR_MESSAGE,
	onRetry,
	loadingLabel = DEFAULT_LOADING_LABEL,
	className,
}: DataRegionProps<TData>): ReactElement {
	if (isLoading) {
		return (
			<output
				className={cn("block w-full", className)}
				aria-busy="true"
				aria-live="polite"
				aria-label={loadingLabel}
			>
				{renderLoading ? (
					renderLoading()
				) : (
					<div className="space-y-3">
						<Skeleton className="h-6 w-2/3" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-5/6" />
					</div>
				)}
				<span className="sr-only">{loadingLabel}…</span>
			</output>
		);
	}

	if (isError) {
		return (
			<div className={cn("w-full", className)}>
				{renderError ? (
					renderError(error, onRetry)
				) : (
					<div
						role="alert"
						className="flex flex-col items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					>
						<p>{errorMessage}</p>
						{onRetry ? (
							<button
								type="button"
								onClick={onRetry}
								className="inline-flex items-center justify-center rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
							>
								Try again
							</button>
						) : null}
					</div>
				)}
			</div>
		);
	}

	const empty = isEmpty ?? (data === null || data === undefined);
	if (empty) {
		return (
			<div className={cn("w-full", className)}>
				{renderEmpty ? (
					renderEmpty()
				) : (
					<output className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
						<p>{emptyMessage}</p>
					</output>
				)}
			</div>
		);
	}

	// `empty` being false guarantees `data` is non-null here.
	return <>{resolveChildren(children, data as TData)}</>;
}
