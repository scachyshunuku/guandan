import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  describe("drag-to-reorder", () => {
    // jsdom has no layout engine, so document.elementFromPoint always
    // returns null unless stubbed — point it at whichever slot a test wants
    // the drag to be "hovering" over.
    function mockElementFromPoint(target: Element | null) {
      // jsdom doesn't implement elementFromPoint at all (no layout engine),
      // so it can't be jest.spyOn'd — define it outright for the test.
      document.elementFromPoint = jest.fn().mockReturnValue(target);
    }

    afterEach(() => {
      // @ts-expect-error - removing the test-only stub added above
      delete document.elementFromPoint;
      window.localStorage.clear();
      jest.restoreAllMocks();
    });

    it("reorders cards on mouse-style pointer drag", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      const reorderedLabels = screen
        .getAllByTestId("card")
        .map((card) => card.getAttribute("aria-label"));
      expect(reorderedLabels).toEqual([
        "7 of hearts",
        "red joker",
        "3 of clubs",
      ]);
    });

    it("reorders cards on touch pointer drag", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[1]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 100, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      const reorderedLabels = screen
        .getAllByTestId("card")
        .map((card) => card.getAttribute("aria-label"));
      expect(reorderedLabels).toEqual([
        "7 of hearts",
        "3 of clubs",
        "red joker",
      ]);
    });

    it("ends the drag when the pointer is released outside every card slot (no local pointerup fires)", () => {
      // No setPointerCapture (see handlePointerDown) means a release outside
      // the hand row - e.g. dragging up into the score board above it -
      // never fires any slot's onPointerUp. A window-level listener is what
      // ends the drag in that case; this asserts a stray hover afterward
      // (button no longer held) doesn't keep silently reordering.
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      const orderAfterDrag = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));

      // Released over window, not over any hand-card-slot.
      fireEvent.pointerUp(window, { pointerId: 1 });

      // Re-query so the mock targets whatever slot is now at visual index 0
      // (which, after the drag above, differs from the still-"dragging"
      // visual index 2 - if the drag didn't truly end, this would resolve
      // to a different index than 2 and trigger a further reorder).
      // Deliberately no `buttons` override on the move below - this isolates
      // the window-level pointerup listener as what ends the drag, rather
      // than the separate event.buttons===0 guard in handlePointerMove.
      const freshSlots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(freshSlots[0]);
      fireEvent.pointerMove(freshSlots[1], { pointerId: 1, clientX: 0, clientY: 0 });

      const orderAfterStrayHover = screen
        .getAllByTestId("card")
        .map((c) => c.getAttribute("aria-label"));
      expect(orderAfterStrayHover).toEqual(orderAfterDrag);
    });

    it("does not toggle the drop-target card's selection when the pointer release is followed by a trailing click", () => {
      // Real browsers fire a native "click" on the drop target right after
      // pointerup for the same gesture - fireEvent doesn't synthesize that
      // automatically, so it's dispatched explicitly here to reproduce it.
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });
      fireEvent.click(within(slots[2]).getByTestId("card"));

      const cards = screen.getAllByTestId("card");
      expect(cards.every((card) => card.getAttribute("aria-pressed") === "false")).toBe(true);
    });

    it("still toggles selection on a plain click (pointer never leaves its own slot)", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      // A plain click's jitter never resolves elementFromPoint to a
      // different slot than the one already being pressed.
      mockElementFromPoint(slots[0]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });
      fireEvent.click(within(slots[0]).getByTestId("card"));

      expect(within(slots[0]).getByTestId("card")).toHaveAttribute("aria-pressed", "true");
    });

    it("keeps selection attached to the dragged card's identity, not its slot", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);

      fireEvent.click(within(slots[0]).getByTestId("card"));
      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      const cards = screen.getAllByTestId("card");
      const selected = cards.find((card) => card.getAttribute("aria-pressed") === "true");
      expect(selected).toHaveAttribute("aria-label", "3 of clubs");
    });

    it("persists the reordered layout to localStorage under persistenceKey", () => {
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      const stored = JSON.parse(
        window.localStorage.getItem("guandan:hand-order:game-1:0") ?? "[]",
      );
      expect(stored).toEqual(["7H#0", "RJ#0", "3C#0"]);
    });

    it("rehydrates a persisted order on mount (survives refresh/reconnect)", () => {
      window.localStorage.setItem(
        "guandan:hand-order:game-1:0",
        JSON.stringify(["7H#0", "RJ#0", "3C#0"]),
      );

      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);

      const labels = screen.getAllByTestId("card").map((card) => card.getAttribute("aria-label"));
      expect(labels).toEqual(["7 of hearts", "red joker", "3 of clubs"]);
    });

    it("appends newly-dealt cards at the end instead of resetting the saved order", () => {
      window.localStorage.setItem(
        "guandan:hand-order:game-1:0",
        JSON.stringify(["7H#0", "3C#0"]),
      );

      const { rerender } = render(
        <PlayerHand hand={HAND.slice(0, 2)} persistenceKey="game-1:0" />,
      );
      expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"))).toEqual([
        "7 of hearts",
        "3 of clubs",
      ]);

      rerender(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);
      expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"))).toEqual([
        "7 of hearts",
        "3 of clubs",
        "red joker",
      ]);
    });

    it("falls back to natural order when stored data has a repeated key (corrupted storage)", () => {
      window.localStorage.setItem(
        "guandan:hand-order:game-1:0",
        JSON.stringify(["3C#0", "3C#0", "3C#0"]),
      );

      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);

      const labels = screen.getAllByTestId("card").map((card) => card.getAttribute("aria-label"));
      expect(labels).toEqual(["3 of clubs", "7 of hearts", "red joker"]);
    });

    it("writes to localStorage exactly once on mount, already holding the reconciled order", async () => {
      window.localStorage.setItem(
        "guandan:hand-order:game-1:0",
        JSON.stringify(["7H#0", "RJ#0", "3C#0"]),
      );
      const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);
      await waitFor(() => expect(setItemSpy).toHaveBeenCalled());

      const orderWrites = setItemSpy.mock.calls.filter(
        ([key]) => key === "guandan:hand-order:game-1:0",
      );
      expect(orderWrites).toHaveLength(1);
      expect(JSON.parse(orderWrites[0][1])).toEqual(["7H#0", "RJ#0", "3C#0"]);
    });
  });

  describe("server sync (initialServerOrder / onOrderChange)", () => {
    afterEach(() => {
      window.localStorage.clear();
    });

    it("seeds from initialServerOrder when localStorage has nothing (a new device)", () => {
      render(
        <PlayerHand
          hand={HAND}
          persistenceKey="game-1:0"
          initialServerOrder={["7H#0", "RJ#0", "3C#0"]}
        />,
      );

      const labels = screen.getAllByTestId("card").map((card) => card.getAttribute("aria-label"));
      expect(labels).toEqual(["7 of hearts", "red joker", "3 of clubs"]);
    });

    it("prefers localStorage over initialServerOrder when both exist", () => {
      window.localStorage.setItem(
        "guandan:hand-order:game-1:0",
        JSON.stringify(["3C#0", "7H#0", "RJ#0"]),
      );

      render(
        <PlayerHand
          hand={HAND}
          persistenceKey="game-1:0"
          initialServerOrder={["7H#0", "RJ#0", "3C#0"]}
        />,
      );

      const labels = screen.getAllByTestId("card").map((card) => card.getAttribute("aria-label"));
      expect(labels).toEqual(["3 of clubs", "7 of hearts", "red joker"]);
    });

    it("ignores an empty initialServerOrder (no saved arrangement yet)", () => {
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" initialServerOrder={[]} />);

      const labels = screen.getAllByTestId("card").map((card) => card.getAttribute("aria-label"));
      expect(labels).toEqual(["3 of clubs", "7 of hearts", "red joker"]);
    });

    it("calls onOrderChange with the settled order after the debounce interval, once", () => {
      jest.useFakeTimers();
      const onOrderChange = jest.fn();
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" onOrderChange={onOrderChange} />);

      const slots = screen.getAllByTestId("hand-card-slot");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      act(() => {
        jest.advanceTimersByTime(800);
      });

      expect(onOrderChange).toHaveBeenCalledTimes(1);
      expect(onOrderChange).toHaveBeenCalledWith(["7H#0", "RJ#0", "3C#0"]);

      // @ts-expect-error - test-only stub
      delete document.elementFromPoint;
      jest.useRealTimers();
    });

    it("does not call onOrderChange before the debounce interval elapses", () => {
      jest.useFakeTimers();
      const onOrderChange = jest.fn();
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" onOrderChange={onOrderChange} />);

      const slots = screen.getAllByTestId("hand-card-slot");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(onOrderChange).not.toHaveBeenCalled();

      // @ts-expect-error - test-only stub
      delete document.elementFromPoint;
      jest.useRealTimers();
    });

    it("sends the reconciled post-play order, not the stale pre-play one, when a card is played mid-debounce", () => {
      // Reproduces: player drags to reorder, then plays a card (hand
      // shrinks) before the debounced server sync fires. The sync must
      // reflect the hand as it is once it actually sends, not a snapshot
      // from before the play - otherwise it'd reference a card the player
      // no longer holds.
      jest.useFakeTimers();
      const onOrderChange = jest.fn();
      const { rerender } = render(
        <PlayerHand hand={HAND} persistenceKey="game-1:0" onOrderChange={onOrderChange} />,
      );

      const slots = screen.getAllByTestId("hand-card-slot");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerMove(slots[0], { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(slots[0], { pointerId: 1 });

      // Partway through the debounce window - the sync hasn't fired yet.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(onOrderChange).not.toHaveBeenCalled();

      // "3 of clubs" is played - hand shrinks to the other two cards.
      const handAfterPlay = HAND.filter((card) => card.rank !== "3");
      rerender(
        <PlayerHand hand={handAfterPlay} persistenceKey="game-1:0" onOrderChange={onOrderChange} />,
      );

      act(() => {
        jest.advanceTimersByTime(800);
      });

      expect(onOrderChange).toHaveBeenCalledTimes(1);
      expect(onOrderChange).toHaveBeenCalledWith(["7H#0", "RJ#0"]);

      // @ts-expect-error - test-only stub
      delete document.elementFromPoint;
      jest.useRealTimers();
    });
  });
});
