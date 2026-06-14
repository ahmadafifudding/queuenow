import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataRegion } from "./DataRegion";

describe("DataRegion", () => {
	it("renders an accessible loading state when isLoading is true", () => {
		render(
			<DataRegion isLoading data={null} loadingLabel="Loading queue">
				content
			</DataRegion>,
		);

		const region = screen.getByRole("status", { name: "Loading queue" });
		expect(region).toHaveAttribute("aria-busy", "true");
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	it("prefers the loading state over error and empty states", () => {
		render(
			<DataRegion isLoading isError isEmpty data={null} errorMessage="boom" />,
		);

		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("renders a friendly error alert with mapped copy (never raw error)", () => {
		render(
			<DataRegion
				isLoading={false}
				isError
				error={new Error("raw stack trace leak")}
				data={null}
				errorMessage="We could not load the queue."
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("We could not load the queue.");
		expect(alert).not.toHaveTextContent("raw stack trace leak");
	});

	it("invokes onRetry from the default error state", async () => {
		const user = userEvent.setup();
		const onRetry = vi.fn();

		render(
			<DataRegion isLoading={false} isError data={null} onRetry={onRetry} />,
		);

		await user.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("does not render a retry button when onRetry is omitted", () => {
		render(<DataRegion isLoading={false} isError data={null} />);

		expect(
			screen.queryByRole("button", { name: "Try again" }),
		).not.toBeInTheDocument();
	});

	it("renders the empty state when data is null and not loading/erroring", () => {
		render(
			<DataRegion isLoading={false} data={null} emptyMessage="No tickets yet.">
				content
			</DataRegion>,
		);

		expect(screen.getByText("No tickets yet.")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	it("honours an explicit isEmpty override even when data is present", () => {
		render(
			<DataRegion
				isLoading={false}
				isEmpty
				data={[1, 2, 3]}
				emptyMessage="Filtered to nothing."
			>
				content
			</DataRegion>,
		);

		expect(screen.getByText("Filtered to nothing.")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	it("renders static children in the success branch", () => {
		render(
			<DataRegion isLoading={false} data={{ id: 1 }}>
				<span>loaded content</span>
			</DataRegion>,
		);

		expect(screen.getByText("loaded content")).toBeInTheDocument();
	});

	it("passes non-null data to a render-prop child", () => {
		render(
			<DataRegion isLoading={false} data={{ name: "Counter 1" }}>
				{(value) => <span>{value.name}</span>}
			</DataRegion>,
		);

		expect(screen.getByText("Counter 1")).toBeInTheDocument();
	});

	it("uses custom state renderers when provided", () => {
		render(
			<DataRegion
				isLoading={false}
				isError
				error="x"
				data={null}
				renderError={(_error, retry) => (
					<button type="button" onClick={retry}>
						custom retry
					</button>
				)}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "custom retry" }),
		).toBeInTheDocument();
	});
});
