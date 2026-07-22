import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WildCardSelector from "./WildCardSelector";

describe("WildCardSelector", () => {
  it("renders all 13 ranks", () => {
    render(<WildCardSelector onConfirm={jest.fn()} />);
    expect(screen.getAllByTestId("wild-card-rank-option")).toHaveLength(13);
  });

  it("renders all 4 suits", () => {
    render(<WildCardSelector onConfirm={jest.fn()} />);
    expect(screen.getAllByTestId("wild-card-suit-option")).toHaveLength(4);
  });

  it("disables Confirm until both a rank and a suit are chosen", async () => {
    const user = userEvent.setup();
    render(<WildCardSelector onConfirm={jest.fn()} />);
    expect(screen.getByTestId("wild-card-confirm-button")).toBeDisabled();

    await user.click(screen.getAllByTestId("wild-card-rank-option")[0]);
    expect(screen.getByTestId("wild-card-confirm-button")).toBeDisabled();

    await user.click(screen.getAllByTestId("wild-card-suit-option")[0]);
    expect(screen.getByTestId("wild-card-confirm-button")).toBeEnabled();
  });

  it("marks the chosen rank and suit as pressed", async () => {
    const user = userEvent.setup();
    render(<WildCardSelector onConfirm={jest.fn()} />);

    const queenOption = screen
      .getAllByTestId("wild-card-rank-option")
      .find((el) => el.getAttribute("data-rank") === "QUEEN")!;
    await user.click(queenOption);
    expect(queenOption).toHaveAttribute("aria-pressed", "true");

    const heartsOption = screen
      .getAllByTestId("wild-card-suit-option")
      .find((el) => el.getAttribute("data-suit") === "HEARTS")!;
    await user.click(heartsOption);
    expect(heartsOption).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onConfirm with the selected rank and suit", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    render(<WildCardSelector onConfirm={onConfirm} />);

    const kingOption = screen
      .getAllByTestId("wild-card-rank-option")
      .find((el) => el.getAttribute("data-rank") === "KING")!;
    const spadesOption = screen
      .getAllByTestId("wild-card-suit-option")
      .find((el) => el.getAttribute("data-suit") === "SPADES")!;
    await user.click(kingOption);
    await user.click(spadesOption);
    await user.click(screen.getByTestId("wild-card-confirm-button"));

    expect(onConfirm).toHaveBeenCalledWith({ rank: "KING", suit: "SPADES" });
  });

  it("shows a Cancel button only when onCancel is provided", () => {
    const { rerender } = render(<WildCardSelector onConfirm={jest.fn()} />);
    expect(screen.queryByTestId("wild-card-cancel-button")).not.toBeInTheDocument();

    rerender(<WildCardSelector onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId("wild-card-cancel-button")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    render(<WildCardSelector onConfirm={jest.fn()} onCancel={onCancel} />);
    await user.click(screen.getByTestId("wild-card-cancel-button"));
    expect(onCancel).toHaveBeenCalled();
  });
});
