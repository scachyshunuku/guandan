import { render, screen } from "@testing-library/react";
import GameHistory from "./GameHistory";
import type { GameAction, GameParticipant } from "@/lib/types";

function makeAction(overrides: Partial<GameAction>): GameAction {
  return {
    id: "action-1",
    gameId: "game-1",
    roundId: "round-1",
    playerId: "player-1",
    actionType: "pass",
    actionData: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Alice",
    playerId: "player-1",
    position: 0,
    hand: [],
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GameHistory", () => {
  it("shows a loading state", () => {
    render(<GameHistory actions={[]} isLoading />);
    expect(screen.getByTestId("game-history-loading")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    render(<GameHistory actions={[]} error={new Error("Failed to load history")} />);
    expect(screen.getByTestId("game-history-error")).toHaveTextContent("Failed to load history");
  });

  it("shows an empty state when there are no actions", () => {
    render(<GameHistory actions={[]} />);
    expect(screen.getByTestId("game-history-empty")).toBeInTheDocument();
  });

  it("falls back to a position label for a card_played action with no matching participant", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "card_played",
            actionData: { position: 1, cards: [{ suit: "SPADES", rank: "3" }] },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("Position 1 played");
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });

  it("resolves a card_played action's position to a participant name", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "card_played",
            actionData: { position: 1, cards: [{ suit: "SPADES", rank: "3" }] },
          }),
        ]}
        participants={[makeParticipant({ playerName: "Bob", position: 1 })]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("Bob played");
  });

  it("resolves a pass action's playerId to a participant name", () => {
    render(
      <GameHistory
        actions={[makeAction({ actionType: "pass", playerId: "player-1" })]}
        participants={[makeParticipant({ playerId: "player-1", playerName: "Alice" })]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("Alice passed");
  });

  it("falls back to a generic label for an unresolvable pass playerId", () => {
    render(<GameHistory actions={[makeAction({ actionType: "pass", playerId: "unknown" })]} />);
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("A player passed");
  });

  it("describes a card_exchange action, falling back to position labels", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "card_exchange",
            actionData: {
              from: 0,
              to: 2,
              card: { suit: "HEARTS", rank: "ACE" },
              type: "initial",
            },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent(
      "Position 0 gave Position 2 a card (initial)",
    );
  });

  it("resolves a card_exchange action's positions to participant names", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "card_exchange",
            actionData: {
              from: 0,
              to: 2,
              card: { suit: "HEARTS", rank: "ACE" },
              type: "initial",
            },
          }),
        ]}
        participants={[
          makeParticipant({ playerName: "Alice", position: 0 }),
          makeParticipant({ playerName: "Carol", position: 2 }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent(
      "Alice gave Carol a card (initial)",
    );
  });

  it("describes a join action for a seated player", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "join",
            actionData: { playerName: "Bob", position: 1 },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent(
      "Bob joined at seat 2",
    );
  });

  it("describes a join action for a spectator", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "join",
            actionData: { playerName: "Carol", position: null },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent(
      "Carol joined as a spectator",
    );
  });

  it("describes a leave action", () => {
    render(
      <GameHistory
        actions={[
          makeAction({
            actionType: "leave",
            actionData: { playerName: "Dave", position: 3 },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("Dave left seat 4");
  });

  it("falls back to a generic label for an unrecognized action type", () => {
    render(
      <GameHistory
        actions={[
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately outside the known GameActionType union
          makeAction({ actionType: "future_action_type" as any, actionData: {} }),
        ]}
      />,
    );
    expect(screen.getByTestId("game-history-entry")).toHaveTextContent("Unknown action");
  });
});
