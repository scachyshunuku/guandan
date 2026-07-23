import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JoinGameForm from "./JoinGameForm";

describe("JoinGameForm", () => {
  it("shows a validation error and does not submit when fields are empty", async () => {
    const user = userEvent.setup();
    const onJoinGame = jest.fn();
    render(<JoinGameForm onJoinGame={onJoinGame} />);

    await user.click(screen.getByTestId("join-game-button"));

    expect(onJoinGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("join-game-error")).toHaveTextContent(
      "Game code and player name are required",
    );
  });

  it("shows a validation error when fields are whitespace-only", async () => {
    const user = userEvent.setup();
    const onJoinGame = jest.fn();
    render(<JoinGameForm onJoinGame={onJoinGame} />);

    await user.type(screen.getByTestId("game-id-input"), "   ");
    await user.type(screen.getByTestId("player-name-input"), "   ");
    await user.click(screen.getByTestId("join-game-button"));

    expect(onJoinGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("join-game-error")).toHaveTextContent(
      "Game code and player name are required",
    );
  });

  it("submits the trimmed game code and player name", async () => {
    const user = userEvent.setup();
    const onJoinGame = jest.fn();
    render(<JoinGameForm onJoinGame={onJoinGame} />);

    await user.type(screen.getByTestId("game-id-input"), "  game-123  ");
    await user.type(screen.getByTestId("player-name-input"), "  Alice  ");
    await user.click(screen.getByTestId("join-game-button"));

    expect(onJoinGame).toHaveBeenCalledWith("game-123", "Alice");
    expect(screen.queryByTestId("join-game-error")).not.toBeInTheDocument();
  });

  it("prefills the game code from initialGameId", () => {
    render(<JoinGameForm onJoinGame={jest.fn()} initialGameId="game-abc" />);
    expect(screen.getByTestId("game-id-input")).toHaveValue("game-abc");
  });

  it("disables the submit button while joining", () => {
    render(<JoinGameForm onJoinGame={jest.fn()} isJoining />);
    expect(screen.getByTestId("join-game-button")).toBeDisabled();
    expect(screen.getByTestId("join-game-button")).toHaveTextContent("Joining…");
  });

  it("shows a server-provided error", () => {
    render(<JoinGameForm onJoinGame={jest.fn()} error="Game not found" />);
    expect(screen.getByTestId("join-game-error")).toHaveTextContent("Game not found");
  });
});
