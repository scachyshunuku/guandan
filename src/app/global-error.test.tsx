import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "./global-error";

// Root layout's own error boundary (only global-error.tsx can catch a throw
// in app/layout.tsx itself - see error.tsx's doc comment). It has to render
// its own <html>/<body>, so this is the one component in the app that isn't
// meant to be mounted inside RTL's default container - render it directly
// anyway to confirm the message/retry wiring works.
describe("GlobalError", () => {
  it("shows the error message and calls reset on retry", async () => {
    const reset = jest.fn();
    const user = userEvent.setup();
    render(<GlobalError error={new Error("Root layout crashed")} reset={reset} />);

    expect(screen.getByText("Root layout crashed")).toBeInTheDocument();
    await user.click(screen.getByTestId("global-error-retry-button"));
    expect(reset).toHaveBeenCalled();
  });
});
