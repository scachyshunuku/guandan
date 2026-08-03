import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RulesAccess from "./RulesAccess";

describe("RulesAccess", () => {
  it("opens the rules from the app shell and closes it again", async () => {
    const user = userEvent.setup();
    render(<RulesAccess />);

    expect(screen.getByTestId("rules-open-button")).toBeInTheDocument();
    expect(screen.queryByTestId("rules-modal")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("rules-open-button"));
    expect(screen.getByTestId("rules-modal")).toBeInTheDocument();
    const tributeLinks = screen.getAllByRole("link", { name: "tribute" });
    expect(tributeLinks).toHaveLength(3);
    expect(tributeLinks[0]).toHaveAttribute("href", "#rules-section-exchange");
    expect(screen.getByText(/compare the triple only/)).toBeInTheDocument();

    await user.click(screen.getByTestId("rules-modal-close-button"));
    expect(screen.queryByTestId("rules-modal")).not.toBeInTheDocument();
  });
});
