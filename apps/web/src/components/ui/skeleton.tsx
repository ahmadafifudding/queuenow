import type { HTMLAttributes, ReactElement } from 'react';

import { cn } from '@/lib/utils';

/**
 * Minimal, self-contained skeleton placeholder.
 *
 * Mirrors the shadcn/ui `Skeleton` API (a styled `div` accepting `className`)
 * so it can be transparently replaced by the registry component later without
 * changing call sites. Decorative by default — hidden from assistive tech.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
