import { render, screen } from "@testing-library/react";
import GameTable from "./GameTable";
import { PASS } from "@/lib/types";
import type { GameParticipant, GameRound } from "@/lib/types";

function participant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    handCount: overrides.hand?.length ?? 0,
    handOrder: overrides.handOrder ?? null,
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    isBot: false,
    ...overrides,
  };
}

const PARTICIPANTS: GameParticipant[] = [
  participant({
    id: "p0",
    playerName: "Alice",
    position: 0,
    hand: new Array(13).fill({ rank: "3" }),
  }),
  participant({
    id: "p1",
    playerName: "Bob",
    position: 1,
    hand: new Array(11).fill({ rank: "3" }),
  }),
  participant({
    id: "p2",
    playerName: "Carol",
    position: 2,
    hand: new Array(9).fill({ rank: "3" }),
  }),
  participant({
    id: "p3",
    playerName: "Dave",
    position: 3,
    hand: new Array(13).fill({ rank: "3" }),
    isConnected: false,
  }),
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
      <GameTable
        round={round({})}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    expect(screen.getAllByTestId("player-card")).toHaveLength(4);
  });

  it("always lists seats in raw position order, alternating Team A/Team B/Team A/Team B regardless of who's viewing", () => {
    render(
      <GameTable
        round={round({})}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    expect(screen.getByTestId("seat-position-0")).toHaveTextContent("Alice");
    expect(screen.getByTestId("seat-position-1")).toHaveTextContent("Bob");
    expect(screen.getByTestId("seat-position-2")).toHaveTextContent("Carol");
    expect(screen.getByTestId("seat-position-3")).toHaveTextContent("Dave");
  });

  it("doesn't reorder seats for a different viewer", () => {
    render(
      <GameTable
        round={round({})}
        participants={PARTICIPANTS}
        myPosition={2}
      />,
    );
    expect(screen.getByTestId("seat-position-0")).toHaveTextContent("Alice");
    expect(screen.getByTestId("seat-position-1")).toHaveTextContent("Bob");
    expect(screen.getByTestId("seat-position-2")).toHaveTextContent("Carol");
    expect(screen.getByTestId("seat-position-3")).toHaveTextContent("Dave");
  });

  it("doesn't reorder seats for a spectator", () => {
    render(
      <GameTable
        round={round({})}
        participants={PARTICIPANTS}
        myPosition={null}
      />,
    );
    expect(screen.getByTestId("seat-position-0")).toHaveTextContent("Alice");
  });

  it("shows an empty seat placeholder when a position is unfilled", () => {
    render(
      <GameTable
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
        round={round({ currentPlayerTurn: 1 })}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    const cards = screen.getAllByTestId("player-card");
    const bob = cards.find((c) => c.getAttribute("data-position") === "1");
    expect(bob).toHaveTextContent("Current turn");
  });

  it("shows a waiting placeholder in every seat when no trick has started", () => {
    render(
      <GameTable
        round={round({})}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );
    expect(screen.getAllByTestId("trick-display-waiting")).toHaveLength(4);
  });

  it("shows each seat's play in its corresponding row beside the fixed seat column", () => {
    render(
      <GameTable
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

    const alice = screen.getByTestId("seat-position-0");
    expect(alice).toHaveTextContent("Alice");
    const aliceCards = screen.getAllByTestId("trick-display-cards").find(
      (element) => (element.parentElement as HTMLElement).style.gridRow === "1",
    );
    expect(
      aliceCards?.querySelector('[data-testid="card"]'),
    ).toBeInTheDocument();

    const bob = screen.getByTestId("seat-position-1");
    expect(bob).toHaveTextContent("Bob");
    expect(
      screen.getAllByTestId("trick-display-pass").find(
        (element) => (element.parentElement as HTMLElement).style.gridRow === "2",
      ),
    ).toBeInTheDocument();

    // Carol/Dave haven't acted yet this trick.
    const waitingRows = screen
      .getAllByTestId("trick-display-waiting")
      .filter((element) => ["3", "4"].includes((element as HTMLElement).style.gridRow));
    expect(waitingRows).toHaveLength(2);
    expect(screen.getByTestId("trick-scroll-container")).not.toContainElement(alice);
  });

  it("renders the actual cards played, not just a count", () => {
    render(
      <GameTable
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

  it("keeps seats on the left while newest plays appear leftmost and push older plays right", () => {
    render(
      <GameTable
        round={round({
          leaderPosition: 0,
          gameState: {
            currentTrick: [
              { position: 0, play: [{ suit: "CLUBS", rank: "3" }] },
              { position: 1, play: PASS },
              { position: 2, play: PASS },
              { position: 3, play: [{ suit: "HEARTS", rank: "4" }] },
              // 0 comes back around and plays again, since only 3 has beaten
              // them so far and everyone else has passed.
              { position: 0, play: [{ suit: "SPADES", rank: "5" }] },
            ],
            trickCount: 0,
            finishOrder: [],
          },
        })}
        participants={PARTICIPANTS}
        myPosition={0}
      />,
    );

    const alice = screen.getByTestId("seat-position-0");
    const aliceRounds = screen
      .getAllByTestId("trick-display-round")
      .filter((element) => (element as HTMLElement).style.gridRow === "1");
    expect(aliceRounds).toHaveLength(2);
    // The newest play (5 of spades) is nearest the seat on the left, while
    // the older play (3 of clubs) has been pushed to the right.
    expect(
      aliceRounds[0].querySelector('[data-testid="card"]'),
    ).toHaveAccessibleName("3 of clubs");
    expect(
      aliceRounds[1].querySelector('[data-testid="card"]'),
    ).toHaveAccessibleName("5 of spades");
    const aliceRound1Column = (aliceRounds[0] as HTMLElement).style.gridColumn;
    const aliceRound2Column = (aliceRounds[1] as HTMLElement).style.gridColumn;
    expect(aliceRound1Column).not.toBe(aliceRound2Column);
    expect(aliceRound1Column).toBe("4");
    expect(aliceRound2Column).toBe("2");
    expect(
      (alice.querySelector('[data-testid="player-card"]') as HTMLElement)
        .parentElement?.style.gridColumn,
    ).toBe("1");
    const dividers = screen.getAllByTestId("trick-display-divider");
    expect(dividers).toHaveLength(1);
    expect((dividers[0] as HTMLElement).style.gridColumn).toBe("3");
    expect((dividers[0] as HTMLElement).style.gridRow).toBe("1 / span 4");

    // Dave only acted once, in what's still round 1 — his single play lands
    // in the same column as Alice's round-1 play, not off on its own.
    const daveRounds = screen
      .getAllByTestId("trick-display-round")
      .filter((element) => (element as HTMLElement).style.gridRow === "4");
    expect(daveRounds).toHaveLength(1);
    expect((daveRounds[0] as HTMLElement).style.gridColumn).toBe(
      aliceRound1Column,
    );

    // No numeric round-number labels anywhere in the trick display.
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("keeps every pass a seat has made this trick, not just the latest", () => {
    render(
      <GameTable
        round={round({
          leaderPosition: 0,
          gameState: {
            currentTrick: [
              { position: 1, play: PASS },
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

    const bob = screen.getByTestId("seat-position-1");
    expect(bob).toHaveTextContent("Bob");
    expect(
      screen
        .getAllByTestId("trick-display-pass")
        .filter((element) => (element.parentElement as HTMLElement).style.gridRow === "2"),
    ).toHaveLength(2);
  });

  it("handles no round yet (game still waiting)", () => {
    render(
      <GameTable round={null} participants={PARTICIPANTS} myPosition={0} />,
    );
    expect(screen.getAllByTestId("trick-display-waiting")).toHaveLength(4);
    expect(screen.getAllByTestId("player-card")).toHaveLength(4);
  });
});
