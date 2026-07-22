import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateGameForm from "./CreateGameForm";

describe("CreateGameForm", () => {
  it("calls onCreateGame when the Create Game button is clicked", async () => {
    const user = userEvent.setup();
    const onCreateGame = jest.fn();
    render(<CreateGameForm onCreateGame={onCreateGame} />);

    await user.click(screen.getByTestId("create-game-button"));
    expect(onCreateGame).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows a pending label while creating", () => {
    render(<CreateGameForm onCreateGame={jest.fn()} isCreating />);
    expect(screen.getByTestId("create-game-button")).toBeDisabled();
    expect(screen.getByTestId("create-game-button")).toHaveTextContent("Creating…");
  });

  it("shows an error message when creation fails", () => {
    render(<CreateGameForm onCreateGame={jest.fn()} error="Failed to create game" />);
    expect(screen.getByTestId("create-game-error")).toHaveTextContent("Failed to create game");
  });

  it("shows a shareable link once the game has been created", () => {
    render(<CreateGameForm onCreateGame={jest.fn()} gameId="game-123" />);
    expect(screen.queryByTestId("create-game-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-link-input")).toHaveValue(
      `${window.location.origin}/game/game-123`,
    );
    expect(screen.getByTestId("enter-game-link")).toHaveAttribute("href", "/game/game-123");
  });

  it("copies the link to the clipboard when Copy is clicked", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CreateGameForm onCreateGame={jest.fn()} gameId="game-123" />);
    await user.click(screen.getByTestId("copy-link-button"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/game/game-123`),
    );
    expect(screen.getByTestId("copy-link-button")).toHaveTextContent("Copied!");
  });
});
