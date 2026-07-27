import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TributeChoiceModal from "./TributeChoiceModal";
import type { Card, GameParticipant } from "@/lib/types";

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

const THIRD_CARD: Card = { suit: "CLUBS", rank: "9" };
const FOURTH_CARD: Card = { suit: "SPADES", rank: "9" };

describe("TributeChoiceModal", () => {
  it("shows both tied cards by player name and lets 1st place choose", async () => {
    const user = userEvent.setup();
    const onChoose = jest.fn();
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        participants={PARTICIPANTS}
        isFirstPlace={true}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByTestId("tribute-choice-prompt")).toHaveTextContent("Bob and Dave gave tied tribute cards");
    const options = screen.getAllByTestId("tribute-choice-option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("From Bob");
    expect(options[1]).toHaveTextContent("From Dave");

    await user.click(within(options[0]).getByTestId("card"));
    expect(onChoose).toHaveBeenCalledWith(1);
  });

  it("calls onChoose with the fourth position when that option is picked", async () => {
    const user = userEvent.setup();
    const onChoose = jest.fn();
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        participants={PARTICIPANTS}
        isFirstPlace={true}
        onChoose={onChoose}
      />,
    );
    const options = screen.getAllByTestId("tribute-choice-option");
    await user.click(within(options[1]).getByTestId("card"));
    expect(onChoose).toHaveBeenCalledWith(3);
  });

  it("falls back to a position label when a name can't be resolved", () => {
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        participants={[]}
        isFirstPlace={true}
        onChoose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("tribute-choice-prompt")).toHaveTextContent(
      "Position 1 and Position 3 gave tied tribute cards",
    );
  });

  it("shows a waiting message, not the choice buttons, for anyone but 1st place", () => {
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        participants={PARTICIPANTS}
        isFirstPlace={false}
        onChoose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("tribute-choice-waiting")).toHaveTextContent("Bob and Dave gave tied tribute cards");
    expect(screen.queryByTestId("tribute-choice-option")).not.toBeInTheDocument();
  });

  it("disables the choice buttons while a submission is in flight", () => {
    render(
      <TributeChoiceModal
        thirdPosition={1}
        thirdCard={THIRD_CARD}
        fourthPosition={3}
        fourthCard={FOURTH_CARD}
        participants={PARTICIPANTS}
        isFirstPlace={true}
        onChoose={jest.fn()}
        isSubmitting={true}
      />,
    );
    for (const option of screen.getAllByTestId("tribute-choice-option")) {
      expect(within(option).getByTestId("card")).toBeDisabled();
    }
  });
});
