import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardExchangeModal from "./CardExchangeModal";
import type { CardExchangeActionData, CardWithWild, GameParticipant } from "@/lib/types";

function participant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    handCount: overrides.hand?.length ?? 0,
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PARTICIPANTS: GameParticipant[] = [
  participant({ id: "p0", playerName: "Alice", position: 0 }),
  participant({ id: "p1", playerName: "Bob", position: 1 }),
  participant({ id: "p2", playerName: "Carol", position: 2 }),
  participant({ id: "p3", playerName: "Dave", position: 3 }),
];

const HAND: CardWithWild[] = [
  { suit: "CLUBS", rank: "3" },
  { suit: "DIAMONDS", rank: "4" },
];

const INITIAL_EXCHANGES: CardExchangeActionData[] = [
  { from: 3, to: 0, card: { suit: "SPADES", rank: "ACE" }, type: "initial" },
  { from: 2, to: 1, card: { suit: "HEARTS", rank: "KING" }, type: "initial" },
];

describe("CardExchangeModal", () => {
  it("shows every initial exchange, read-only, by player name", () => {
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        participants={PARTICIPANTS}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    const entries = screen.getAllByTestId("initial-exchange-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Dave → Alice");
    expect(entries[1]).toHaveTextContent("Carol → Bob");
  });

  it("prompts the recipient to choose a return card, by player name", () => {
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        participants={PARTICIPANTS}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("return-prompt")).toHaveTextContent(
      "Choose a card to give back to Dave",
    );
    expect(screen.getAllByTestId("return-card-options")[0].querySelectorAll('[data-testid="card"]')).toHaveLength(
      HAND.length,
    );
  });

  it("falls back to a position label when a name can't be resolved", () => {
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        participants={[]}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("return-prompt")).toHaveTextContent(
      "Choose a card to give back to Position 3",
    );
  });

  it("shows a waiting message and the giver's own hand, read-only, for a player who didn't receive a card", () => {
    render(
      <CardExchangeModal
        myPosition={3}
        hand={HAND}
        participants={PARTICIPANTS}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={jest.fn()}
      />,
    );
    expect(screen.getByTestId("no-return-needed")).toBeInTheDocument();
    expect(screen.queryByTestId("return-prompt")).not.toBeInTheDocument();
    expect(screen.getByTestId("own-hand-preview").querySelectorAll('[data-testid="card"]')).toHaveLength(
      HAND.length,
    );
  });

  it("disables Submit until a return card is selected", async () => {
    const user = userEvent.setup();
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        participants={PARTICIPANTS}
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
        participants={PARTICIPANTS}
        initialExchanges={INITIAL_EXCHANGES}
        onSubmitReturn={onSubmitReturn}
      />,
    );
    const handCards = screen.getByTestId("return-card-options").querySelectorAll('[data-testid="card"]');
    await user.click(handCards[1]);
    await user.click(screen.getByTestId("submit-return-button"));
    expect(onSubmitReturn).toHaveBeenCalledWith(HAND[1]);
  });

  it("disables Submit while a submission is in flight", async () => {
    const user = userEvent.setup();
    render(
      <CardExchangeModal
        myPosition={0}
        hand={HAND}
        participants={PARTICIPANTS}
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
