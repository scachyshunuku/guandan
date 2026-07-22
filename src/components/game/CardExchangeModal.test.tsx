import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardExchangeModal from "./CardExchangeModal";
import type { CardExchangeActionData, CardWithWild } from "@/lib/types";

const HAND: CardWithWild[] = [
  { suit: "CLUBS", rank: "3" },
  { suit: "DIAMONDS", rank: "4" },
];

const INITIAL_EXCHANGES: CardExchangeActionData[] = [
  { from: 3, to: 0, card: { suit: "SPADES", rank: "ACE" }, type: "initial" },
  { from: 2, to: 1, card: { suit: "HEARTS", rank: "KING" }, type: "initial" },
];

describe("CardExchangeModal", () => {
  it("shows every initial exchange, read-only", () => {
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    const entries = screen.getAllByTestId("initial-exchange-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Position 3 → Position 0");
    expect(entries[1]).toHaveTextContent("Position 2 → Position 1");
  });

  it("prompts the recipient to choose a return card", () => {
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("return-prompt")).toHaveTextContent(
      "Choose a card to give back to position 3",
    );
    expect(screen.getAllByTestId("return-card-options")[0].querySelectorAll('[data-testid="card"]')).toHaveLength(
      HAND.length,
    );
  });

  it("shows a waiting message for a player who didn't receive a card", () => {
    render(
      <CardExchangeModal
        myPosition={3}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("no-return-needed")).toBeInTheDocument();
    expect(screen.queryByTestId("return-prompt")).not.toBeInTheDocument();
  });

  it("disables Submit until a return card is selected", async () => {
    const user = userEvent.setup();
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("submit-return-button")).toBeDisabled();

    const handCards = screen.getByTestId("return-card-options").querySelectorAll('[data-testid="card"]');
    await user.click(handCards[0]);
    expect(screen.getByTestId("submit-return-button")).toBeEnabled();
  });

  it("calls onSubmitReturn with the selected card", async () => {
    const user = userEvent.setup();
    const onSubmitReturn = jest.fn();
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={onSubmitReturn}
      />,
    );
    const handCards = screen.getByTestId("return-card-options").querySelectorAll('[data-testid="card"]');
    await user.click(handCards[1]);
    await user.click(screen.getByTestId("submit-return-button"));
    // myPosition=0 received its card from position 3 (see INITIAL_EXCHANGES).
    expect(onSubmitReturn).toHaveBeenCalledWith(HAND[1], 3);
  });

  it("disables Submit while a submission is in flight", async () => {
    const user = userEvent.setup();
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
        isSubmitting={true}
      />,
    );
    const handCards = screen.getByTestId("return-card-options").querySelectorAll('[data-testid="card"]');
    await user.click(handCards[0]);
    expect(screen.getByTestId("submit-return-button")).toBeDisabled();
  });
});
