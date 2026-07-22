import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/lib/playerId", () => ({
  getOrCreatePlayerId: () => "player-fixed",
}));

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as jest.Mock;
}

describe("Home", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("creates a game and shows the shareable link", async () => {
    mockFetchOnce(201, { gameId: "game-123" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByTestId("create-game-button"));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/create",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByTestId("game-link-input")).toHaveValue(
      `${window.location.origin}/game/game-123`,
    );
  });

  it("joins a game and navigates to it", async () => {
    mockFetchOnce(201, { spectator: false, position: 0, hand: [] });
    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByTestId("game-id-input"), "game-456");
    await user.type(screen.getByTestId("player-name-input"), "Alice");
    await user.click(screen.getByTestId("join-game-button"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/game/game-456/join",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ playerName: "Alice", playerId: "player-fixed" }),
        }),
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/game/game-456"));
  });

  it("shows an error and does not navigate when joining fails", async () => {
    mockFetchOnce(404, { error: "Game not found" });
    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByTestId("game-id-input"), "missing-game");
    await user.type(screen.getByTestId("player-name-input"), "Alice");
    await user.click(screen.getByTestId("join-game-button"));

    expect(await screen.findByTestId("join-game-error")).toHaveTextContent("Game not found");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an error when game creation fails", async () => {
    mockFetchOnce(500, { error: "Failed to create game" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByTestId("create-game-button"));

    expect(await screen.findByTestId("create-game-error")).toHaveTextContent(
      "Failed to create game",
    );
    expect(screen.queryByTestId("game-link-input")).not.toBeInTheDocument();
  });

  it("URL-encodes a game code containing special characters when joining", async () => {
    mockFetchOnce(201, { spectator: true });
    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByTestId("game-id-input"), "game/456");
    await user.type(screen.getByTestId("player-name-input"), "Alice");
    await user.click(screen.getByTestId("join-game-button"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/game/game%2F456/join",
        expect.anything(),
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/game/game%2F456"));
  });
});
