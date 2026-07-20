import { render, screen } from "@testing-library/react";
import PlayerCard from "./PlayerCard";

describe("PlayerCard", () => {
  it("renders the player's name, seat, and position", () => {
    render(
      <PlayerCard
        playerName="Alice"
        position={1}
        seatLabel="west"
        isConnected
        cardCount={13}
      />,
    );
    expect(screen.getByTestId("player-name")).toHaveTextContent("Alice");
    expect(screen.getByTestId("seat-label")).toHaveTextContent("west");
    expect(screen.getByTestId("player-card")).toHaveAttribute("data-position", "1");
  });

  it("marks the viewer's own seat", () => {
    render(
      <PlayerCard
        playerName="Alice"
        position={0}
        seatLabel="south"
        isConnected
        cardCount={13}
        isSelf
      />,
    );
    expect(screen.getByTestId("player-name")).toHaveTextContent("Alice (You)");
  });

  it("shows the card count", () => {
    render(
      <PlayerCard playerName="Bob" position={2} seatLabel="north" isConnected cardCount={7} />,
    );
    expect(screen.getByTestId("card-count")).toHaveTextContent("7 cards");
  });

  it("pluralizes a single remaining card correctly", () => {
    render(
      <PlayerCard playerName="Bob" position={2} seatLabel="north" isConnected cardCount={1} />,
    );
    expect(screen.getByTestId("card-count")).toHaveTextContent("1 card");
  });

  it("renders connected status", () => {
    render(
      <PlayerCard playerName="Bob" position={2} seatLabel="north" isConnected cardCount={7} />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected");
  });

  it("renders disconnected status", () => {
    render(
      <PlayerCard
        playerName="Bob"
        position={2}
        seatLabel="north"
        isConnected={false}
        cardCount={7}
      />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Disconnected");
  });

  it("shows a current-turn indicator when it's this player's turn", () => {
    render(
      <PlayerCard
        playerName="Bob"
        position={2}
        seatLabel="north"
        isConnected
        cardCount={7}
        isCurrentTurn
      />,
    );
    expect(screen.getByTestId("current-turn-indicator")).toBeInTheDocument();
  });

  it("omits the current-turn indicator otherwise", () => {
    render(
      <PlayerCard playerName="Bob" position={2} seatLabel="north" isConnected cardCount={7} />,
    );
    expect(screen.queryByTestId("current-turn-indicator")).not.toBeInTheDocument();
  });
});
