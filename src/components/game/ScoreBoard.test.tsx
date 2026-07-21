import { render, screen } from "@testing-library/react";
import ScoreBoard from "./ScoreBoard";

describe("ScoreBoard", () => {
  it("displays each team's level", () => {
    render(
      <ScoreBoard game={{ teamALevel: 5, teamBLevel: 3, winningTeam: null }} />,
    );
    expect(screen.getByTestId("score-board-team-0")).toHaveTextContent("Team A");
    expect(screen.getByTestId("score-board-team-0")).toHaveTextContent("Level 5");
    expect(screen.getByTestId("score-board-team-1")).toHaveTextContent("Team B");
    expect(screen.getByTestId("score-board-team-1")).toHaveTextContent("Level 3");
  });

  it("labels face levels with their short rank", () => {
    render(
      <ScoreBoard game={{ teamALevel: 14, teamBLevel: 11, winningTeam: null }} />,
    );
    expect(screen.getByTestId("score-board-team-0")).toHaveTextContent("Level A");
    expect(screen.getByTestId("score-board-team-1")).toHaveTextContent("Level J");
  });

  it("shows the level progression visual with the right number of filled segments", () => {
    render(
      <ScoreBoard game={{ teamALevel: 4, teamBLevel: 2, winningTeam: null }} />,
    );
    const teamASegments = screen
      .getByTestId("score-board-team-0")
      .querySelectorAll('[data-testid="score-board-progress-segment"]');
    expect(teamASegments).toHaveLength(13);
    const filled = Array.from(teamASegments).filter(
      (el) => el.getAttribute("data-filled") === "true",
    );
    expect(filled).toHaveLength(3); // levels 2, 3, 4
  });

  it("marks the winning team", () => {
    render(
      <ScoreBoard game={{ teamALevel: 14, teamBLevel: 10, winningTeam: 0 }} />,
    );
    expect(screen.getByTestId("score-board-team-0")).toHaveTextContent("Winner");
    expect(screen.getByTestId("score-board-team-1")).not.toHaveTextContent("Winner");
  });

  it("shows no winner indicator while the game is undecided", () => {
    render(
      <ScoreBoard game={{ teamALevel: 5, teamBLevel: 5, winningTeam: null }} />,
    );
    expect(screen.queryByTestId("score-board-winner")).not.toBeInTheDocument();
  });
});
