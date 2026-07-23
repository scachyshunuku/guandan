import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteError from "./error";

describe("RouteError", () => {
  it("shows the error message and calls reset on retry", async () => {
    const reset = jest.fn();
    const user = userEvent.setup();
    render(<RouteError error={new Error("Something broke")} reset={reset} />);

    expect(screen.getByText("Something broke")).toBeInTheDocument();
    await user.click(screen.getByTestId("error-retry-button"));
    expect(reset).toHaveBeenCalled();
  });
});
