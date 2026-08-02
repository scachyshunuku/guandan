import { render, screen } from "@testing-library/react";
import RoundEndSummary from "./RoundEndSummary";
import type { GameParticipant } from "@/lib/types";

function makeParticipant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    handCount: 0,
    handOrder: null,
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    isBot: false,
    ...overrides,
  };
}

const PARTICIPANTS: GameParticipant[] = [
  makeParticipant({ id: "p0", playerName: "Alice", position: 0 }),
  makeParticipant({ id: "p1", playerName: "Bob", position: 1 }),
  makeParticipant({ id: "p2", playerName: "Carol", position: 2 }),
  makeParticipant({ id: "p3", playerName: "Dave", position: 3 }),
];

describe("RoundEndSummary", () => {
  it("lists every seat's place, including one that never played its last card", () => {
    // 1-4 finish: position 0 finished first, position 2 second, position 3
    // third, position 1 (a 1-4 finish's auto-placed 4th - RULES.md "Round
    // End") never actually played out.
    render(<RoundEndSummary finishingPositions={[1, 4, 2, 3]} participants={PARTICIPANTS} />);

    const entries = screen.getAllByTestId("round-end-place");
    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveTextContent("1st place — Alice");
    expect(entries[1]).toHaveTextContent("2nd place — Carol");
    expect(entries[2]).toHaveTextContent("3rd place — Dave");
    expect(entries[3]).toHaveTextContent("4th place — Bob");
  });

  it("falls back to a position label when a finisher isn't a current participant", () => {
    render(<RoundEndSummary finishingPositions={[1, 4, 2, 3]} participants={[]} />);
    expect(screen.getByTestId("round-end-summary")).toHaveTextContent("Position 0");
  });
});
