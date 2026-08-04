import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlayerHand from "./PlayerHand";
import type { CardWithWild } from "@/lib/types";

const HAND: CardWithWild[] = [
  { suit: "CLUBS", rank: "3" },
  { suit: "HEARTS", rank: "7" },
  { rank: "RED_JOKER" },
];

// jsdom has no `PointerEvent` constructor at all, so
// @testing-library/dom's fireEvent.pointer* helpers silently fall back to a
// bare `Event` when they look one up - which drops clientX/clientY/buttons
// entirely, since the plain Event constructor only recognizes
// bubbles/cancelable/composed from its init dict. That's invisible to every
// other test in this file (they stub document.elementFromPoint and never
// read real coordinates), but tests that need genuine coordinates - the
// drag-activation threshold, drop-side detection, marquee select - dispatch
// a MouseEvent carrying the pointer event's type name instead: jsdom does
// implement MouseEvent (with working clientX/clientY/buttons), and both the
// DOM and React dispatch listeners by an event's `type` string, not its
// exact constructor.
function firePointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  target: Element | Window,
  init: {
    clientX?: number;
    clientY?: number;
    button?: number;
    buttons?: number;
    pointerId?: number;
  } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === "pointerup" || type === "pointercancel" ? 0 : 1),
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  fireEvent(target, event);
}

// jsdom has no layout engine, so every element's getBoundingClientRect()
// reports an all-zero rect unless stubbed.
function stubRect(el: Element, rect: { left: number; top: number; right: number; bottom: number }) {
  el.getBoundingClientRect = jest.fn(() => ({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON() {},
  })) as unknown as () => DOMRect;
}

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

  it("keeps uncontrolled selection attached to card identity when a preceding card leaves", () => {
    const { rerender } = render(<PlayerHand hand={HAND} />);
    fireEvent.click(screen.getByLabelText("7 of hearts"));

    rerender(<PlayerHand hand={HAND.slice(1)} />);

    expect(screen.getByLabelText("7 of hearts")).toHaveAttribute("aria-pressed", "true");
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

    it("does not start dragging (or reorder) for a press that never exceeds the activation threshold", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 2, clientY: 1 }); // well under the 4px threshold
      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("drop-placeholder")).not.toBeInTheDocument();

      firePointerEvent("pointerup", container);

      const labels = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(labels).toEqual(["3 of clubs", "7 of hearts", "red joker"]);
    });

    it("shows a floating dragging-card and a single-card drop-placeholder once the threshold is exceeded", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[1]);
      stubRect(slots[1], { left: 0, top: 0, right: 100, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 20, clientY: 0 });

      expect(screen.getAllByTestId("dragging-card")).toHaveLength(1);
      expect(screen.getByTestId("drop-placeholder")).toBeInTheDocument();
      // The dragged card no longer occupies a normal grid slot while it's
      // floating - only the other two remain.
      expect(screen.getAllByTestId("hand-card-slot")).toHaveLength(HAND.length - 1);

      firePointerEvent("pointerup", container);
      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("drop-placeholder")).not.toBeInTheDocument();
    });

    it("reorders on drop, inserting before the hovered card when dropped on its left half", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]); // hover "red joker"
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 }); // midpoint at x=150

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab "3 of clubs"
      firePointerEvent("pointermove", container, { clientX: 120, clientY: 0 }); // left of the midpoint
      firePointerEvent("pointerup", container);

      const labels = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(labels).toEqual(["7 of hearts", "3 of clubs", "red joker"]);
    });

    it("reorders on drop, inserting after the hovered card when dropped on its right half", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]); // hover "red joker"
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 }); // midpoint at x=150

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab "3 of clubs"
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 }); // right of the midpoint
      firePointerEvent("pointerup", container);

      const labels = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(labels).toEqual(["7 of hearts", "red joker", "3 of clubs"]);
    });

    it("treats a drag dropped back on its own starting slot as a no-op, without re-syncing the unchanged order", () => {
      // Regression test: releasing a drag exactly where it started used to
      // still commit a freshly-built (but content-identical) orderKeys
      // array, which reset the debounced server-sync timer and replayed
      // every downstream effect keyed on orderKeys - a full, pointless
      // "hand refresh" for a gesture that changed nothing.
      jest.useFakeTimers();
      const onOrderChange = jest.fn();
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" onOrderChange={onOrderChange} />);

      // Let the mount-triggered sync settle first so it can't be confused
      // with one caused by the no-op drag below.
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(onOrderChange).toHaveBeenCalledTimes(1);
      onOrderChange.mockClear();

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[1]); // hover "7 of hearts", now sitting where "3 of clubs" left off
      stubRect(slots[1], { left: 100, top: 0, right: 200, bottom: 90 }); // midpoint at x=150

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab "3 of clubs"
      firePointerEvent("pointermove", container, { clientX: 120, clientY: 0 }); // left of the midpoint - back where it started
      firePointerEvent("pointerup", container);

      const labels = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(labels).toEqual(["3 of clubs", "7 of hearts", "red joker"]);

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(onOrderChange).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("reorders on touch pointer drag", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[1]);
      stubRect(slots[1], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 }); // right half of "7 of hearts"
      firePointerEvent("pointerup", container);

      const labels = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(labels).toEqual(["7 of hearts", "3 of clubs", "red joker"]);
    });

    it("ends the drag when the pointer is released outside every card slot (window-level fallback), and a stray hover afterward changes nothing further", () => {
      // No setPointerCapture (see handleCardPointerDown) means a release
      // outside the panel - e.g. dragging up into the score board above it,
      // a perfectly natural gesture - never fires the container's own
      // onPointerUp. A window-level listener is what ends the drag in that
      // case; this asserts a stray hover afterward (buttons no longer held)
      // doesn't keep silently updating anything.
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      expect(screen.getByTestId("dragging-card")).toBeInTheDocument();

      // Released over window, not over the panel.
      firePointerEvent("pointerup", window);
      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();

      const orderAfterDrop = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(orderAfterDrop).toEqual(["7 of hearts", "red joker", "3 of clubs"]);

      firePointerEvent("pointermove", container, { clientX: 0, clientY: 0, buttons: 0 });
      const orderAfterStrayHover = screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"));
      expect(orderAfterStrayHover).toEqual(orderAfterDrop);
    });

    it("keeps the floating group following the pointer after it leaves the hand container", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      mockElementFromPoint(slots[2]);
      stubRect(slots[0], { left: 10, top: 10, right: 74, bottom: 106 });

      firePointerEvent("pointerdown", slots[0], { clientX: 20, clientY: 20 });
      firePointerEvent("pointermove", window, { clientX: 80, clientY: 20 });

      const overlay = screen.getByTestId("dragging-card");
      expect(overlay).toHaveStyle({ left: "70px", top: "10px" });

      firePointerEvent("pointerup", window);
    });

    it("cancels an interrupted pointer drag without committing its tentative reorder", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", window, { clientX: 180, clientY: 0 });
      firePointerEvent("pointercancel", window);

      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"))).toEqual([
        "3 of clubs",
        "7 of hearts",
        "red joker",
      ]);
      // The cancellation also releases the active pointer, so a new drag can
      // begin normally instead of being rejected as a second pointer.
      firePointerEvent("pointerdown", container, { clientX: 0, clientY: 0 });
    });

    it("does not swallow the next card click when an outside drop has no trailing click", () => {
      jest.useFakeTimers();
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", window, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", window); // no browser click follows an outside release
      act(() => jest.runOnlyPendingTimers());

      fireEvent.click(within(container).getAllByTestId("card")[0]);
      expect(within(container).getAllByTestId("card")[0]).toHaveAttribute("aria-pressed", "true");
      jest.useRealTimers();
    });

    it("supports keyboard arrow reordering for the focused card", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.keyDown(cards[0], { key: "ArrowRight" });

      expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"))).toEqual([
        "7 of hearts",
        "3 of clubs",
        "red joker",
      ]);
    });

    it("supports keyboard shift-arrow range selection", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.keyDown(cards[0], { key: "ArrowRight", shiftKey: true });

      expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "false",
      ]);
    });

    it("does not toggle the drop-target card's selection when the pointer release is followed by a trailing click", () => {
      // Real browsers fire a native "click" on the drop target right after
      // pointerup for the same gesture - fireEvent doesn't synthesize that
      // automatically, so it's dispatched explicitly here to reproduce it.
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);
      fireEvent.click(within(slots[2]).getByTestId("card"));

      const cards = screen.getAllByTestId("card");
      expect(cards.every((card) => card.getAttribute("aria-pressed") === "false")).toBe(true);
    });

    it("still toggles selection on a plain click (pointer never leaves its own slot)", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      // A plain click's jitter never exceeds the drag-activation threshold.
      firePointerEvent("pointermove", container, { clientX: 1, clientY: 0 });
      firePointerEvent("pointerup", container);
      fireEvent.click(within(slots[0]).getByTestId("card"));

      expect(within(slots[0]).getByTestId("card")).toHaveAttribute("aria-pressed", "true");
    });

    it("does not re-run the FLIP layout pass for a plain click (regression: draggingKeys/dropIndex are also seeded and cleared on every press, not just real drags)", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      slots.forEach((slot, i) => stubRect(slot, { left: i * 100, top: 0, right: i * 100 + 90, bottom: 90 }));
      // Excludes slot 0 (the grabbed card): handleCardPointerDown always
      // reads its own currentTarget rect to seed drag state, on every press
      // regardless of whether it turns into a real drag - that's expected,
      // unrelated to the FLIP pass this test is isolating. The other slots
      // have no legitimate reason to be measured at all for a plain click.
      const otherRectMocks = slots.slice(1).map((slot) => slot.getBoundingClientRect as jest.Mock);
      const callsBefore = otherRectMocks.reduce((sum, mock) => sum + mock.mock.calls.length, 0);

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      // A plain click's jitter never exceeds the drag-activation threshold.
      firePointerEvent("pointermove", container, { clientX: 1, clientY: 0 });
      firePointerEvent("pointerup", container);
      fireEvent.click(within(slots[0]).getByTestId("card"));

      const callsAfter = otherRectMocks.reduce((sum, mock) => sum + mock.mock.calls.length, 0);
      expect(callsAfter).toBe(callsBefore);
    });

    it("keeps selection attached to the dragged card's identity, not its slot", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      fireEvent.click(within(slots[0]).getByTestId("card"));
      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);

      const cards = screen.getAllByTestId("card");
      const selected = cards.find((card) => card.getAttribute("aria-pressed") === "true");
      expect(selected).toHaveAttribute("aria-label", "3 of clubs");
    });

    it("persists the reordered layout to localStorage under persistenceKey", () => {
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);

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
      // @ts-expect-error - test-only stub, may or may not have been set
      delete document.elementFromPoint;
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
      const container = screen.getByTestId("player-hand");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });
      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(onOrderChange).toHaveBeenCalledTimes(1);
      expect(onOrderChange).toHaveBeenCalledWith(["7H#0", "RJ#0", "3C#0"]);

      jest.useRealTimers();
    });

    it("does not call onOrderChange before the debounce interval elapses", () => {
      jest.useFakeTimers();
      const onOrderChange = jest.fn();
      render(<PlayerHand hand={HAND} persistenceKey="game-1:0" onOrderChange={onOrderChange} />);

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });
      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(onOrderChange).not.toHaveBeenCalled();

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
      const container = screen.getByTestId("player-hand");
      document.elementFromPoint = jest.fn().mockReturnValue(slots[2]);
      stubRect(slots[2], { left: 100, top: 0, right: 200, bottom: 90 });
      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      firePointerEvent("pointerup", container);

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
        jest.advanceTimersByTime(3000);
      });

      expect(onOrderChange).toHaveBeenCalledTimes(1);
      expect(onOrderChange).toHaveBeenCalledWith(["7H#0", "RJ#0"]);

      jest.useRealTimers();
    });
  });

  describe("multiselect group drag", () => {
    const FOUR_CARD_HAND: CardWithWild[] = [
      { suit: "CLUBS", rank: "3" },
      { suit: "HEARTS", rank: "7" },
      { rank: "RED_JOKER" },
      { suit: "DIAMONDS", rank: "5" },
    ];
    const SIX_CARD_HAND: CardWithWild[] = [
      ...FOUR_CARD_HAND,
      { suit: "SPADES", rank: "9" },
      { suit: "CLUBS", rank: "KING" },
    ];

    function mockElementFromPoint(target: Element | null) {
      document.elementFromPoint = jest.fn().mockReturnValue(target);
    }

    afterEach(() => {
      // @ts-expect-error - removing the test-only stub added above
      delete document.elementFromPoint;
      jest.restoreAllMocks();
    });

    it("moves the whole selection together, preserving relative order and the hand's grid footprint", () => {
      render(<PlayerHand hand={FOUR_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");
      // Select "3 of clubs" and "red joker" (indices 0 and 2), leaving "7 of
      // hearts" (index 1) unselected and in between them.
      fireEvent.click(cards[0]);
      fireEvent.click(cards[2]);

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[3]); // hover "5 of diamonds", the last slot
      stubRect(slots[3], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab "3 of clubs"
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 }); // right half of "5 of diamonds"

      // A single insertion gap marks the drop target regardless of how many
      // cards are in the group - they land there together and the rest of
      // the hand reflows to its natural wrap once dropped.
      expect(screen.getAllByTestId("hand-card-slot")).toHaveLength(2);
      expect(screen.getByTestId("drop-placeholder")).toBeInTheDocument();
      expect(screen.getAllByTestId("dragging-card")).toHaveLength(2);

      firePointerEvent("pointerup", container);

      const reorderedLabels = screen
        .getAllByTestId("card")
        .map((card) => card.getAttribute("aria-label"));
      // Both dragged cards land after "5 of diamonds", still adjacent to
      // each other and in their original relative order - "7 of hearts",
      // never part of the drag, stays where the group left it.
      expect(reorderedLabels).toEqual([
        "7 of hearts",
        "5 of diamonds",
        "3 of clubs",
        "red joker",
      ]);
    });

    it("still only drags the single grabbed card when it isn't part of a multi-card selection", () => {
      render(<PlayerHand hand={FOUR_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[2]); // select just "red joker" - a lone selection

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[3]);
      stubRect(slots[3], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab "3 of clubs" - unselected
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      expect(screen.getAllByTestId("dragging-card")).toHaveLength(1);
      firePointerEvent("pointerup", container);

      const reorderedLabels = screen
        .getAllByTestId("card")
        .map((card) => card.getAttribute("aria-label"));
      expect(reorderedLabels).toEqual([
        "7 of hearts",
        "red joker",
        "5 of diamonds",
        "3 of clubs",
      ]);
    });

    it("lands the group in the same place regardless of which selected card is grabbed", () => {
      // Same selection ("3 of clubs" + "red joker", "7 of hearts" untouched
      // in between) and hover target as the first test above, but grabbed
      // from the *other* end of the selection - the result must be
      // identical, since the gesture (drag this selection over "5 of
      // diamonds") is the same regardless of which card the pointer
      // happened to land on.
      render(<PlayerHand hand={FOUR_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]);
      fireEvent.click(cards[2]);

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[3]);
      stubRect(slots[3], { left: 100, top: 0, right: 200, bottom: 90 });

      firePointerEvent("pointerdown", slots[2], { clientX: 0, clientY: 0 }); // grab "red joker" this time
      firePointerEvent("pointermove", container, { clientX: 180, clientY: 0 });
      // The floating group is packed around the grabbed card, so its initial
      // placeholder footprint starts after the one unselected card that was
      // before the grabbed card. This prevents the overlay from landing on
      // that card when the original selection was non-adjacent.
      expect(within(container.firstElementChild as HTMLElement).getByTestId("card"))
        .toHaveAttribute("aria-label", "7 of hearts");
      firePointerEvent("pointerup", container);

      const reorderedLabels = screen
        .getAllByTestId("card")
        .map((card) => card.getAttribute("aria-label"));
      expect(reorderedLabels).toEqual([
        "7 of hearts",
        "5 of diamonds",
        "3 of clubs",
        "red joker",
      ]);
    });

    it("condenses a multi-card drag into a single overlapping stack instead of spreading the cards out", () => {
      render(<PlayerHand hand={SIX_CARD_HAND} selectedIndices={[0, 1, 2, 3, 4]} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      stubRect(slots[0], { left: 0, top: 0, right: 50, bottom: 90 });
      mockElementFromPoint(slots[0]);

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 }); // grab the first card in the group
      firePointerEvent("pointermove", container, { clientX: 10, clientY: 0 });

      const overlays = screen.getAllByTestId("dragging-card");
      expect(overlays).toHaveLength(5);
      // Each card sits a small, constant offset from the grabbed one (here,
      // the first in the group) instead of spreading out at the hand grid's
      // own spacing, and stacks front-to-back so the grabbed card is on top.
      overlays.forEach((overlay, index) => {
        expect(overlay.style.left).toBe(`${10 + index * 4}px`);
        expect(overlay.style.top).toBe(`${index * 4}px`);
      });
      expect(Number(overlays[0].style.zIndex)).toBeGreaterThan(Number(overlays[4].style.zIndex));

      firePointerEvent("pointerup", container);
    });
  });

  describe("hold/drag animation", () => {
    function mockElementFromPoint(target: Element | null) {
      document.elementFromPoint = jest.fn().mockReturnValue(target);
    }

    afterEach(() => {
      // @ts-expect-error - removing the test-only stub added above
      delete document.elementFromPoint;
    });

    it("does not show the floating drag overlay until the press exceeds the activation threshold", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[0]);

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 2, clientY: 1 }); // under the threshold
      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();

      firePointerEvent("pointerup", container);
    });

    it("lifts the dragged card into a floating overlay that follows the pointer once past the threshold", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[0]); // stays over its own original position - isolates the follow animation from any reorder

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 40, clientY: 15 });

      const overlay = screen.getByTestId("dragging-card");
      expect(overlay).toBeInTheDocument();
      // The overlay tracks the pointer via a fixed position, decoupled from
      // wherever the card's slot happens to be in the flex layout - not a
      // transform relative to a position that reordering could also move.
      expect(overlay.style.position).toBe("fixed");
      expect(overlay.style.pointerEvents).toBe("none");

      firePointerEvent("pointerup", container);
      expect(screen.queryByTestId("dragging-card")).not.toBeInTheDocument();
    });

    it("shows the whole selected group in the floating overlay when dragging a multi-card selection", () => {
      const FOUR_CARD_HAND: CardWithWild[] = [
        { suit: "CLUBS", rank: "3" },
        { suit: "HEARTS", rank: "7" },
        { rank: "RED_JOKER" },
        { suit: "DIAMONDS", rank: "5" },
      ];
      render(<PlayerHand hand={FOUR_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]);
      fireEvent.click(cards[2]);

      const slots = screen.getAllByTestId("hand-card-slot");
      const container = screen.getByTestId("player-hand");
      mockElementFromPoint(slots[0]);

      firePointerEvent("pointerdown", slots[0], { clientX: 0, clientY: 0 });
      firePointerEvent("pointermove", container, { clientX: 40, clientY: 0 });

      expect(screen.getAllByTestId("dragging-card")).toHaveLength(2);

      firePointerEvent("pointerup", container);
    });
  });

  describe("marquee (rubber-band) box select", () => {
    it("selects every card the box touches as it's dragged, and shows a translucent overlay", () => {
      render(<PlayerHand hand={HAND} />);
      const container = screen.getByTestId("player-hand");
      const slots = screen.getAllByTestId("hand-card-slot");
      stubRect(container, { left: 0, top: 0, right: 300, bottom: 100 });
      stubRect(slots[0], { left: 0, top: 0, right: 50, bottom: 90 }); // 3 of clubs
      stubRect(slots[1], { left: 60, top: 0, right: 110, bottom: 90 }); // 7 of hearts
      stubRect(slots[2], { left: 120, top: 0, right: 170, bottom: 90 }); // red joker

      // Starts in the empty gap between slot 0 and slot 1, and is dragged
      // far enough right to touch slots 1 and 2 but never slot 0.
      firePointerEvent("pointerdown", container, { clientX: 70, clientY: 10 });
      expect(screen.getByTestId("marquee-select-box")).toBeInTheDocument();

      firePointerEvent("pointermove", window, { clientX: 200, clientY: 50 });

      const cards = screen.getAllByTestId("card");
      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true", "true"]);

      firePointerEvent("pointerup", window);
      expect(screen.queryByTestId("marquee-select-box")).not.toBeInTheDocument();
      // Selection stays as the box left it once the drag ends.
      expect(
        screen.getAllByTestId("card").map((c) => c.getAttribute("aria-pressed")),
      ).toEqual(["false", "true", "true"]);
    });

    it("clears the selection on a click in empty panel space (a zero-size box)", () => {
      render(<PlayerHand hand={HAND} />);
      const container = screen.getByTestId("player-hand");
      const cards = screen.getAllByTestId("card");
      stubRect(container, { left: 0, top: 0, right: 300, bottom: 100 });

      fireEvent.click(cards[0]);
      expect(cards[0]).toHaveAttribute("aria-pressed", "true");

      firePointerEvent("pointerdown", container, { clientX: 10, clientY: 10 });
      firePointerEvent("pointerup", window, { clientX: 10, clientY: 10 });

      expect(
        screen.getAllByTestId("card").map((c) => c.getAttribute("aria-pressed")),
      ).toEqual(["false", "false", "false"]);
    });

    it("does not start a marquee when the press originates on a card slot", () => {
      render(<PlayerHand hand={HAND} />);
      const slots = screen.getAllByTestId("hand-card-slot");

      fireEvent.pointerDown(slots[0], { pointerId: 1, pointerType: "mouse", button: 0 });
      expect(screen.queryByTestId("marquee-select-box")).not.toBeInTheDocument();
    });

    it("does not let a second pointer start a competing marquee", () => {
      render(<PlayerHand hand={HAND} />);
      const container = screen.getByTestId("player-hand");

      firePointerEvent("pointerdown", container, { pointerId: 1, clientX: 10, clientY: 10 });
      firePointerEvent("pointerdown", container, { pointerId: 2, clientX: 40, clientY: 40 });
      firePointerEvent("pointermove", window, { pointerId: 2, clientX: 100, clientY: 100 });

      const box = screen.getByTestId("marquee-select-box");
      expect(box.style.left).toBe("10px");
      expect(box.style.top).toBe("10px");

      firePointerEvent("pointerup", window, { pointerId: 1 });
    });

    it("hit-tests against the current hand, not a stale snapshot, if the hand changes mid-drag", () => {
      // Reproduces: a marquee is in progress when a card leaves the hand
      // (e.g. a play resolves through another input path) - the drag's
      // window-level listeners must keep selecting against the hand as it
      // now stands, not whatever it looked like when the gesture started.
      const { rerender } = render(<PlayerHand hand={HAND} />); // 3 of clubs, 7 of hearts, red joker
      const container = screen.getByTestId("player-hand");
      const slots = screen.getAllByTestId("hand-card-slot");
      stubRect(container, { left: 0, top: 0, right: 300, bottom: 100 });
      stubRect(slots[0], { left: 0, top: 0, right: 50, bottom: 90 });
      stubRect(slots[1], { left: 60, top: 0, right: 110, bottom: 90 });
      stubRect(slots[2], { left: 120, top: 0, right: 170, bottom: 90 });

      firePointerEvent("pointerdown", container, { clientX: 70, clientY: 10 });

      // "3 of clubs" is played away mid-drag - the remaining two cards' DOM
      // slots (React reuses them by their stable slot key) keep the rects
      // already stubbed above.
      rerender(<PlayerHand hand={HAND.slice(1)} />);

      firePointerEvent("pointermove", window, { clientX: 200, clientY: 50 });

      const remainingCards = screen.getAllByTestId("card");
      expect(remainingCards).toHaveLength(2);
      expect(remainingCards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "true"]);

      firePointerEvent("pointerup", window);
    });
  });

  describe("shift-click range select", () => {
    const FIVE_CARD_HAND: CardWithWild[] = [
      { suit: "CLUBS", rank: "3" },
      { suit: "HEARTS", rank: "7" },
      { rank: "RED_JOKER" },
      { suit: "DIAMONDS", rank: "5" },
      { suit: "SPADES", rank: "9" },
    ];

    it("selects the visual range from the last plain-clicked card to the shift-clicked one", () => {
      render(<PlayerHand hand={FIVE_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.click(cards[0]);
      fireEvent.click(cards[3], { shiftKey: true });

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "true",
        "true",
        "false",
      ]);
    });

    it("keeps re-anchoring from the same origin across a chain of shift-clicks, replacing the selection each time", () => {
      render(<PlayerHand hand={FIVE_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.click(cards[0]);
      fireEvent.click(cards[3], { shiftKey: true });
      fireEvent.click(cards[1], { shiftKey: true });

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "false",
        "false",
        "false",
      ]);
    });

    it("works in either direction from the anchor", () => {
      render(<PlayerHand hand={FIVE_CARD_HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.click(cards[3]);
      fireEvent.click(cards[1], { shiftKey: true });

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual([
        "false",
        "true",
        "true",
        "true",
        "false",
      ]);
    });

    it("falls back to selecting just the clicked card when there is no anchor yet", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.click(cards[1], { shiftKey: true });

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    });

    it("falls back to the clicked card when the anchor card has left the hand (e.g. played)", () => {
      const { rerender } = render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]); // anchor = "3 of clubs"

      rerender(<PlayerHand hand={HAND.slice(1)} />); // "3 of clubs" played away

      const remainingCards = screen.getAllByTestId("card");
      fireEvent.click(remainingCards[1], { shiftKey: true }); // shift-click "red joker"

      expect(remainingCards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    });
  });

  describe("deselect on outside click / Escape", () => {
    it("clears the selection when clicking outside every card and control", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]);
      expect(cards[0]).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(document.body);

      expect(cards[0]).toHaveAttribute("aria-pressed", "false");
    });

    it("does not clear the selection when the click lands on a button elsewhere on the page", () => {
      const outsideButton = document.createElement("button");
      outsideButton.type = "button";
      document.body.appendChild(outsideButton);
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]);

      fireEvent.click(outsideButton);

      expect(cards[0]).toHaveAttribute("aria-pressed", "true");
      document.body.removeChild(outsideButton);
    });

    it("clears the selection when Escape is pressed", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");
      fireEvent.click(cards[0]);
      fireEvent.click(cards[1]);
      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    });

    it("is a no-op on Escape or an outside click when nothing is selected", () => {
      render(<PlayerHand hand={HAND} />);
      const cards = screen.getAllByTestId("card");

      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(document.body);

      expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    });
  });

  describe("touch-first gestures", () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    });

    it("does not start a marquee selection from empty hand space", () => {
      const matchMedia = jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: matchMedia,
      });
      const onSelectionChange = jest.fn();
      render(<PlayerHand hand={HAND} selectedIndices={[0]} onSelectionChange={onSelectionChange} />);

      const hand = screen.getByTestId("player-hand");
      firePointerEvent("pointerdown", hand, { clientX: 4, clientY: 4 });
      firePointerEvent("pointermove", window, { clientX: 50, clientY: 50 });

      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId("marquee-select-box")).not.toBeInTheDocument();
      expect(matchMedia).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
    });
  });
});
