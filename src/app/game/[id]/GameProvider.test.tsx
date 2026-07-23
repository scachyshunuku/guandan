import { render, screen } from "@testing-library/react";
import GameProvider, { useGameContext } from "./GameProvider";

const useGameMock = jest.fn();
jest.mock("@/hooks/useGame", () => ({
  useGame: (options: unknown) => useGameMock(options),
}));

jest.mock("@/lib/playerId", () => ({
  getOrCreatePlayerId: () => "player-fixed",
}));

function Consumer() {
  const ctx = useGameContext();
  return (
    <div>
      <span data-testid="ctx-gameId">{ctx.gameId}</span>
      <span data-testid="ctx-status">{ctx.gameStatus}</span>
    </div>
  );
}

describe("GameProvider", () => {
  beforeEach(() => {
    useGameMock.mockReset();
    useGameMock.mockReturnValue({ gameStatus: "waiting" });
  });

  it("resolves the browser playerId and initializes useGame with it", () => {
    render(
      <GameProvider gameId="game-1">
        <Consumer />
      </GameProvider>,
    );

    expect(useGameMock).toHaveBeenCalledWith({ gameId: "game-1", playerId: "player-fixed" });
  });

  it("exposes the useGame() result plus gameId through context", () => {
    useGameMock.mockReturnValue({ gameStatus: "in_progress" });

    render(
      <GameProvider gameId="game-2">
        <Consumer />
      </GameProvider>,
    );

    expect(screen.getByTestId("ctx-gameId")).toHaveTextContent("game-2");
    expect(screen.getByTestId("ctx-status")).toHaveTextContent("in_progress");
  });

  it("useGameContext throws when rendered outside GameProvider", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useGameContext must be used within GameProvider",
    );
    consoleError.mockRestore();
  });
});
