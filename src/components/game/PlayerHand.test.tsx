import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlayerHand from "./PlayerHand";
import type { CardWithWild } from "@/lib/types";

const HAND: CardWithWild[] = [
  { suit: "CLUBS", rank: "3" },
  { suit: "HEARTS", rank: "7" },
  { rank: "RED_JOKER" },
];

describe("PlayerHand", () => {
  it("renders one card per hand entry", () => {
    render(<PlayerHand hand={HAND} />);
    expect(screen.getAllByTestId("card")).toHaveLength(HAND.length);
  });

  it("renders face-down card backs when not the viewer's own hand", () => {
    render(<PlayerHand hand={HAND} isOwnHand={false} />);
    expect(screen.getAllByTestId("card-back")).toHaveLength(HAND.length);
    expect(screen.queryAllByTestId("card")).toHaveLength(0);
  });

  it("toggles selection on click with internal state", async () => {
    const user = userEvent.setup();
    render(<PlayerHand hand={HAND} />);
    const cards = screen.getAllByTestId("card");

    await user.click(cards[0]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");

    await user.click(cards[0]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("supports multiple simultaneous selections", async () => {
    const user = userEvent.setup();
    render(<PlayerHand hand={HAND} />);
    const cards = screen.getAllByTestId("card");

    await user.click(cards[0]);
    await user.click(cards[2]);

    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    expect(cards[1]).toHaveAttribute("aria-pressed", "false");
    expect(cards[2]).toHaveAttribute("aria-pressed", "true");
  });

  it("uses controlled selection when selectedIndices/onSelectionChange are provided", async () => {
    const user = userEvent.setup();
    const onSelectionChange = jest.fn();
    render(
      <PlayerHand
        hand={HAND}
        selectedIndices={[1]}
        onSelectionChange={onSelectionChange}
      />
    );
    const cards = screen.getAllByTestId("card");
    expect(cards[1]).toHaveAttribute("aria-pressed", "true");

    await user.click(cards[0]);
    expect(onSelectionChange).toHaveBeenCalledWith([1, 0]);
    // Controlled: clicking doesn't change rendered state until the parent
    // passes back updated selectedIndices.
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("cancels out two toggles fired in the same batch (rapid double-click)", () => {
    render(<PlayerHand hand={HAND} />);
    const cards = screen.getAllByTestId("card");

    // Both clicks dispatched inside one act() so React batches them without
    // an intervening re-render — a stale-closure toggle would leave this
    // selected instead of cancelling out.
    act(() => {
      fireEvent.click(cards[0]);
      fireEvent.click(cards[0]);
    });

    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("updates rendered selection when the hand prop changes", () => {
    const { rerender } = render(<PlayerHand hand={HAND} />);
    expect(screen.getAllByTestId("card")).toHaveLength(3);

    const shorterHand = HAND.slice(0, 1);
    rerender(<PlayerHand hand={shorterHand} />);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });
});
