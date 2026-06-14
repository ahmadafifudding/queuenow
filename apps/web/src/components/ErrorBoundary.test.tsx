import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
	if (shouldThrow) {
		throw new Error("render explosion");
	}
	return <span>recovered content</span>;
}

describe("ErrorBoundary", () => {
	// React logs caught errors to the console; silence it to keep test output clean.
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders children when no error is thrown", () => {
		render(
			<ErrorBoundary>
				<span>safe content</span>
			</ErrorBoundary>,
		);

		expect(screen.getByText("safe content")).toBeInTheDocument();
	});

	it("renders a friendly, recoverable fallback when a child throws", () => {
		render(
			<ErrorBoundary message="This section failed.">
				<Boom shouldThrow />
			</ErrorBoundary>,
		);

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("This section failed.");
		expect(alert).not.toHaveTextContent("render explosion");
		expect(
			screen.getByRole("button", { name: "Try again" }),
		).toBeInTheDocument();
	});

	it("calls onError with the caught error", () => {
		const onError = vi.fn();

		render(
			<ErrorBoundary onError={onError}>
				<Boom shouldThrow />
			</ErrorBoundary>,
		);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});

	it("recovers the subtree when the reset action is invoked", async () => {
		const user = userEvent.setup();

		function Harness(): ReactElement {
			const [shouldThrow, setShouldThrow] = useState(true);
			return (
				<ErrorBoundary onReset={() => setShouldThrow(false)}>
					<Boom shouldThrow={shouldThrow} />
				</ErrorBoundary>
			);
		}

		render(<Harness />);

		expect(screen.getByRole("alert")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("recovered content")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("supports a custom render-prop fallback", async () => {
		const user = userEvent.setup();

		render(
			<ErrorBoundary
				fallback={({ error, reset }) => (
					<div>
						<p>custom: {error.message}</p>
						<button type="button" onClick={reset}>
							dismiss
						</button>
					</div>
				)}
			>
				<Boom shouldThrow />
			</ErrorBoundary>,
		);

		expect(screen.getByText("custom: render explosion")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "dismiss" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "dismiss" }));
	});
});
