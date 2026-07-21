import { render, screen } from "@testing-library/react";
import TrickDisplay from "./TrickDisplay";
import { PASS } from "@/lib/types";
import type { CurrentTrick } from "@/lib/types";

describe("TrickDisplay", () => {
  it("shows a placeholder when no trick has started", () => {
    render(<TrickDisplay trick={[]} leaderPosition={0} myPosition={0} />);
    expect(screen.getByTestId("trick-display-empty")).toBeInTheDocument();
  });

  it("renders plays in order, in turn order relative to the viewer", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }], PASS];
    render(<TrickDisplay trick={trick} leaderPosition={0} myPosition={0} />);

    const plays = screen.getAllByTestId("trick-display-play");
    expect(plays).toHaveLength(2);
    expect(plays[0]).toHaveAttribute("data-position", "0");
    expect(plays[0]).toHaveTextContent("south");
    expect(plays[1]).toHaveAttribute("data-position", "1");
    expect(plays[1]).toHaveTextContent("east");
  });

  it("reorients seat labels relative to a different viewer", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }]];
    render(<TrickDisplay trick={trick} leaderPosition={0} myPosition={1} />);
    expect(screen.getByTestId("trick-display-play")).toHaveTextContent("west");
  });

  it("renders the actual cards played, not just a count", () => {
    const trick: CurrentTrick = [
      [
        { suit: "CLUBS", rank: "3" },
        { suit: "DIAMONDS", rank: "3" },
      ],
    ];
    render(<TrickDisplay trick={trick} leaderPosition={0} myPosition={0} />);
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("displays pass distinctly from a card play", () => {
    render(<TrickDisplay trick={[PASS]} leaderPosition={0} myPosition={0} />);
    expect(screen.getByTestId("trick-display-pass")).toHaveTextContent("Pass");
    expect(screen.queryByTestId("trick-display-cards")).not.toBeInTheDocument();
  });

  it("shows the wild card actsAs notation", () => {
    const trick: CurrentTrick = [
      [{ suit: "HEARTS", rank: "5", actsAs: { suit: "SPADES", rank: "QUEEN" } }],
    ];
    render(<TrickDisplay trick={trick} leaderPosition={0} myPosition={0} />);
    expect(screen.getByTestId("wild-indicator")).toHaveTextContent("as Q♠");
  });

  it("defaults spectators to position 0's orientation", () => {
    const trick: CurrentTrick = [[{ suit: "CLUBS", rank: "3" }]];
    render(<TrickDisplay trick={trick} leaderPosition={0} myPosition={null} />);
    expect(screen.getByTestId("trick-display-play")).toHaveTextContent("south");
  });
});
