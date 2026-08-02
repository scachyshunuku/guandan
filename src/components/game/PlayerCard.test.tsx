import { render, screen } from "@testing-library/react";
import PlayerCard from "./PlayerCard";

describe("PlayerCard", () => {
  it("renders the player's name, team, and position", () => {
    render(
      <PlayerCard playerName="Alice" position={1} isConnected cardCount={13} />,
    );
    expect(screen.getByTestId("player-name")).toHaveTextContent("Alice");
    expect(screen.getByTestId("team-label")).toHaveTextContent("Team B");
    expect(screen.getByTestId("player-card")).toHaveAttribute(
      "data-position",
      "1",
    );
  });

  it.each([0, 2] as const)("shows Team A for position %i", (position) => {
    render(
      <PlayerCard playerName="Alice" position={position} isConnected cardCount={13} />,
    );
    expect(screen.getByTestId("team-label")).toHaveTextContent("Team A");
    expect(screen.getByTestId("team-label")).toHaveClass("text-blue-600");
  });

  it.each([1, 3] as const)("shows Team B for position %i", (position) => {
    render(
      <PlayerCard playerName="Dave" position={position} isConnected cardCount={13} />,
    );
    expect(screen.getByTestId("team-label")).toHaveTextContent("Team B");
    expect(screen.getByTestId("team-label")).toHaveClass("text-orange-600");
  });

  it("marks the viewer's own seat", () => {
    render(
      <PlayerCard
        playerName="Alice"
        position={0}
        isConnected
        cardCount={13}
        isSelf
      />,
    );
    expect(screen.getByTestId("player-name")).toHaveTextContent("Alice (You)");
  });

  it("shows the card count", () => {
    render(
      <PlayerCard playerName="Bob" position={2} isConnected cardCount={7} />,
    );
    expect(screen.getByTestId("card-count")).toHaveTextContent("7 cards");
  });

  it("pluralizes a single remaining card correctly", () => {
    render(
      <PlayerCard playerName="Bob" position={2} isConnected cardCount={1} />,
    );
    expect(screen.getByTestId("card-count")).toHaveTextContent("1 card");
  });

  it("renders connected status", () => {
    render(
      <PlayerCard playerName="Bob" position={2} isConnected cardCount={7} />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Connected",
    );
  });

  it("renders disconnected status", () => {
    render(
      <PlayerCard
        playerName="Bob"
        position={2}
        isConnected={false}
        cardCount={7}
      />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Disconnected",
    );
  });

  it("shows a current-turn indicator when it's this player's turn", () => {
    render(
      <PlayerCard
        playerName="Bob"
        position={2}
        isConnected
        cardCount={7}
        isCurrentTurn
      />,
    );
    const indicator = screen.getByTestId("current-turn-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).not.toHaveAttribute("aria-hidden", "true");
  });

  it("hides the current-turn indicator otherwise, without removing it from layout", () => {
    render(
      <PlayerCard playerName="Bob" position={2} isConnected cardCount={7} />,
    );
    const indicator = screen.getByTestId("current-turn-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("aria-hidden", "true");
  });
});
