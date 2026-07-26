import { render, screen } from "@testing-library/react";
import SpectatorList from "./SpectatorList";
import type { GameParticipant } from "@/lib/types";

function makeSpectator(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Spectator",
    playerId: "player-id",
    position: null,
    hand: [],
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SpectatorList", () => {
  it("renders nothing when there are no spectators", () => {
    render(<SpectatorList spectators={[]} />);
    expect(screen.queryByTestId("spectator-list")).not.toBeInTheDocument();
  });

  it("shows a singular count for one spectator", () => {
    render(<SpectatorList spectators={[makeSpectator({ playerName: "Erin" })]} />);
    expect(screen.getByTestId("spectator-list-count")).toHaveTextContent("1 spectator");
    expect(screen.getByTestId("spectator-list-names")).toHaveTextContent("Erin");
  });

  it("pluralizes and lists multiple spectator names", () => {
    render(
      <SpectatorList
        spectators={[
          makeSpectator({ id: "s1", playerName: "Erin" }),
          makeSpectator({ id: "s2", playerName: "Frank" }),
        ]}
      />,
    );
    expect(screen.getByTestId("spectator-list-count")).toHaveTextContent("2 spectators");
    expect(screen.getByTestId("spectator-list-names")).toHaveTextContent("Erin, Frank");
  });
});
