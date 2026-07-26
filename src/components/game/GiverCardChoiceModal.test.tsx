import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GiverCardChoiceModal from "./GiverCardChoiceModal";
import type { Card } from "@/lib/types";

const CANDIDATES: Card[] = [
  { suit: "SPADES", rank: "KING" },
  { suit: "HEARTS", rank: "KING" },
];

describe("GiverCardChoiceModal", () => {
  it("shows every tied candidate and calls onChoose with the picked card", async () => {
    const user = userEvent.setup();
    const onChoose = jest.fn();
    render(<GiverCardChoiceModal candidates={CANDIDATES} onChoose={onChoose} />);

    expect(screen.getByTestId("giver-card-choice-prompt")).toBeInTheDocument();
    const cards = screen.getByTestId("giver-card-choice-options").querySelectorAll('[data-testid="card"]');
    expect(cards).toHaveLength(2);

    await user.click(cards[1]);
    expect(onChoose).toHaveBeenCalledWith(CANDIDATES[1]);
  });

  it("disables every candidate while a submission is in flight", () => {
    render(<GiverCardChoiceModal candidates={CANDIDATES} onChoose={jest.fn()} isSubmitting={true} />);
    const cards = screen.getByTestId("giver-card-choice-options").querySelectorAll('[data-testid="card"]');
    for (const card of Array.from(cards)) {
      expect(card).toBeDisabled();
    }
  });
});
