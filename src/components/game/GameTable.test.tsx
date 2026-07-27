import { render, screen } from "@testing-library/react";
import GameTable from "./GameTable";
import { PASS } from "@/lib/types";
import type { Game, GameParticipant, GameRound } from "@/lib/types";

const GAME: Game = {
  id: "game-1",
  status: "in_progress",
  teamALevel: 5,
  teamBLevel: 3,
  winningTeam: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

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
  participant({ id: "p0", playerName: "Alice", position: 0, hand: new Array(13).fill({ rank: "3" }) }),
  participant({ id: "p1", playerName: "Bob", position: 1, hand: new Array(11).fill({ rank: "3" }) }),
  participant({ id: "p2", playerName: "Carol", position: 2, hand: new Array(9).fill({ rank: "3" }) }),
  participant({ id: "p3", playerName: "Dave", position: 3, hand: new Array(13).fill({ rank: "3" }), isConnected: false }),
];

function round(overrides: Partial<GameRound>): GameRound {
  return {
    id: "round-1",
    gameId: "game-1",
    roundNumber: 1,
    gameState: { currentTrick: [], trickCount: 0, finishOrder: [] },
    currentPlayerTurn: 1,
    leaderPosition: 0,
    status: "in_progress",
    finishingPositions: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GameTable", () => {
  it("renders all 4 seats", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={0} />,
    );
    expect(screen.getAllByTestId("player-card")).toHaveLength(4);
  });

  it("places the viewer at south and their partner at north", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={0} />,
    );
    expect(screen.getByTestId("seat-south")).toHaveTextContent("Alice");
    expect(screen.getByTestId("seat-north")).toHaveTextContent("Carol");
  });

  it("orders east/west to match RULES.md's counterclockwise turn order (next to act sits east)", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={0} />,
    );
    // Turn order is (position + 1) % 4, so position 1 (next after the
    // viewer at south) must sit east, and position 3 (previous) sits west.
    expect(screen.getByTestId("seat-east")).toHaveTextContent("Bob");
    expect(screen.getByTestId("seat-west")).toHaveTextContent("Dave");
  });

  it("reorients seats relative to a different viewer", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={1} />,
    );
    expect(screen.getByTestId("seat-south")).toHaveTextContent("Bob");
    expect(screen.getByTestId("seat-north")).toHaveTextContent("Dave");
  });

  it("defaults spectators to position 0's orientation", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={null} />,
    );
    expect(screen.getByTestId("seat-south")).toHaveTextContent("Alice");
  });

  it("shows an empty seat placeholder when a position is unfilled", () => {
    render(
      <GameTable
        game={GAME}
        round={round({})}
        participants={PARTICIPANTS.slice(0, 3)}
        myPosition={0}
      />,
    );
    expect(screen.getAllByTestId("player-card")).toHaveLength(3);
    expect(screen.getByTestId("empty-seat")).toBeInTheDocument();
  });

  it("highlights the current player's turn", () => {
    render(
      <GameTable
        game={GAME}
        round={round({ currentPlayerTurn: 1 })}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    const cards = screen.getAllByTestId("player-card");
    const bob = cards.find((c) => c.getAttribute("data-position") === "1");
    expect(bob).toHaveTextContent("Current turn");
  });

  it("displays team levels", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={0} />,
    );
    expect(screen.getByTestId("team-a-level")).toHaveTextContent("5");
    expect(screen.getByTestId("team-b-level")).toHaveTextContent("3");
  });

  it("shows a waiting placeholder in every seat when no trick has started", () => {
    render(
      <GameTable game={GAME} round={round({})} participants={PARTICIPANTS} myPosition={0} />,
    );
    expect(screen.getAllByTestId("trick-display-waiting")).toHaveLength(4);
  });

  it("shows each seat's play next to their player card, in the same row", () => {
    render(
      <GameTable
        game={GAME}
        round={round({
          leaderPosition: 0,
          gameState: {
            currentTrick: [
              { position: 0, play: [{ suit: "CLUBS", rank: "3" }] },
              { position: 1, play: PASS },
            ],
            trickCount: 0,
            finishOrder: [],
          },
        })}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );

    const south = screen.getByTestId("seat-south");
    expect(south).toHaveTextContent("Alice");
    expect(south.querySelector('[data-testid="trick-display-cards"] [data-testid="card"]')).toBeInTheDocument();

    const east = screen.getByTestId("seat-east");
    expect(east).toHaveTextContent("Bob");
    expect(east.querySelector('[data-testid="trick-display-pass"]')).toBeInTheDocument();

    // North/west haven't acted yet this trick.
    expect(
      screen.getByTestId("seat-north").querySelector('[data-testid="trick-display-waiting"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("seat-west").querySelector('[data-testid="trick-display-waiting"]'),
    ).toBeInTheDocument();
  });

  it("renders the actual cards played, not just a count", () => {
    render(
      <GameTable
        game={GAME}
        round={round({
          gameState: {
            currentTrick: [
              {
                position: 0,
                play: [
                  { suit: "CLUBS", rank: "3" },
                  { suit: "DIAMONDS", rank: "3" },
                ],
              },
            ],
            trickCount: 0,
            finishOrder: [],
          },
        })}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("handles no round yet (game still waiting)", () => {
    render(<GameTable game={GAME} round={null} participants={PARTICIPANTS} myPosition={0} />);
    expect(screen.getAllByTestId("trick-display-waiting")).toHaveLength(4);
    expect(screen.getAllByTestId("player-card")).toHaveLength(4);
  });
});
