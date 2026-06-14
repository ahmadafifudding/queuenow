import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Render-prop signature for a custom recoverable fallback. Receives the caught
 * error and a `reset` callback that clears the boundary so the subtree can
 * re-mount and retry.
 */
export type ErrorBoundaryFallbackRender = (params: {
  error: Error;
  reset: () => void;
}) => ReactNode;

export interface ErrorBoundaryProps {
  /** Subtree to protect. */
  children: ReactNode;
  /**
   * Custom fallback. May be a static node or a render prop that receives the
   * error and a `reset` callback. Defaults to a friendly, recoverable view.
   */
  fallback?: ReactNode | ErrorBoundaryFallbackRender;
  /** Friendly message for the default fallback (never raw error text). */
  message?: string;
  /** Notified when an error is caught, e.g. for logging/telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Called after the boundary resets, e.g. to refetch queries. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const DEFAULT_MESSAGE = 'Something went wrong displaying this section.';

/**
 * Catches render/runtime errors in its subtree and renders a recoverable
 * fallback with a try-again action, instead of unmounting the whole app.
 *
 * Wrap route subtrees with this so an unexpected error in one region degrades
 * gracefully. The default fallback is keyboard-reachable and announced via
 * `role="alert"`.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  public override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback, message = DEFAULT_MESSAGE } = this.props;

    if (error === null) {
      return children;
    }

    if (typeof fallback === 'function') {
      return fallback({ error, reset: this.reset });
    }

    if (fallback !== undefined) {
      return fallback;
    }

    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <p>{message}</p>
        <button
          type="button"
          onClick={this.reset}
          className="inline-flex items-center justify-center rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }
}
