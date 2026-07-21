import { render, screen } from "@testing-library/react";
import TrickDisplay from "./TrickDisplay";
import { PASS } from "@/lib/types";
import type { CurrentTrick, GameParticipant } from "@/lib/types";

function participant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
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

describe("TrickDisplay", () => {
  it("shows a placeholder when no trick has started", () => {
    render(<TrickDisplay trick={[]} leaderPosition={0} participants={PARTICIPANTS} />);
    expect(screen.getByTestId("trick-display-empty")).toBeInTheDocument();
  });

  it("renders one row per player, in player-position order, by name", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }], PASS];
    render(<TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS} />);

    const rows = screen.getAllByTestId("trick-display-player");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("data-position", "0");
    expect(rows[0]).toHaveTextContent("Alice");
    expect(rows[1]).toHaveAttribute("data-position", "1");
    expect(rows[1]).toHaveTextContent("Bob");
  });

  it("shows each player's play to the right of their name", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }], PASS];
    render(<TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS} />);

    const rows = screen.getAllByTestId("trick-display-player");
    expect(rows[0]).toHaveTextContent("Alice");
    expect(rows[0].querySelector('[data-testid="card"]')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Bob");
    expect(rows[1].querySelector('[data-testid="trick-display-pass"]')).toBeInTheDocument();
  });

  it("shows a waiting placeholder for players who haven't acted yet this trick", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }]];
    render(<TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS} />);

    const rows = screen.getAllByTestId("trick-display-player");
    expect(rows[1].querySelector('[data-testid="trick-display-waiting"]')).toBeInTheDocument();
  });

  it("attributes plays to the right player when the leader isn't position 0", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }], PASS];
    render(<TrickDisplay trick={trick} leaderPosition={2} participants={PARTICIPANTS} />);

    const rows = screen.getAllByTestId("trick-display-player");
    // Leader (position 2, Carol) acted first; position 3 (Dave) passed next.
    expect(rows[2]).toHaveTextContent("Carol");
    expect(rows[2].querySelector('[data-testid="card"]')).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("Dave");
    expect(rows[3].querySelector('[data-testid="trick-display-pass"]')).toBeInTheDocument();
  });

  it("renders the actual cards played, not just a count", () => {
    const trick: CurrentTrick = [
      [
        { suit: "CLUBS", rank: "3" },
        { suit: "DIAMONDS", rank: "3" },
      ],
    ];
    render(<TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS} />);
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("shows a distinct card-shaped placeholder for a pass", () => {
    render(<TrickDisplay trick={[PASS]} leaderPosition={0} participants={PARTICIPANTS} />);
    const pass = screen.getByTestId("trick-display-pass");
    expect(pass).toHaveTextContent("PASS");
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
  });

  it("shows the wild card actsAs notation", () => {
    const trick: CurrentTrick = [
      [{ suit: "HEARTS", rank: "5", actsAs: { suit: "SPADES", rank: "QUEEN" } }],
    ];
    render(<TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS} />);
    expect(screen.getByTestId("wild-indicator")).toHaveTextContent("as Q♠");
  });

  it("falls back to a placeholder name for an unfilled seat", () => {
    const trick: CurrentTrick = [PASS];
    render(
      <TrickDisplay trick={trick} leaderPosition={0} participants={PARTICIPANTS.slice(1)} />,
    );
    expect(screen.getAllByTestId("trick-display-player")[0]).toHaveTextContent("—");
  });
});
