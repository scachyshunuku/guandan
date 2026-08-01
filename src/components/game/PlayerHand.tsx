"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardWithWild } from "@/lib/types";
import { encodeCard } from "@/lib/cardUtils";
import Card from "./Card";

export interface PlayerHandProps {
  hand: CardWithWild[];
  // False for other players' hands (e.g. rendered elsewhere on the table) —
  // only the viewing player's own hand is shown face up.
  isOwnHand?: boolean;
  selectedIndices?: number[];
  onSelectionChange?: (selectedIndices: number[]) => void;
  // Enables drag-to-reorder and persists the resulting card order to
  // localStorage under this key (e.g. `${gameId}:${myPosition}`), so a
  // manually arranged hand survives page refresh/reconnect on this device
  // (Task 5.1a). Reordering is display-only — it never touches
  // selectedIndices/hand identity, just which order cards render in.
  // Omitted by callers (tests, dev-preview) that don't need persistence
  // across mounts.
  persistenceKey?: string;
  // Server-saved order (GameStateResponse.myHandOrder) to fall back to at
  // mount when localStorage has nothing yet - the cross-device case
  // localStorage alone can't cover (a fresh browser/device has no saved
  // order for this persistenceKey). Only consulted once, at mount;
  // localStorage always wins if it already has a value, since it reflects
  // whatever this device was most recently showing.
  initialServerOrder?: string[] | null;
  // Called (debounced) with the settled order whenever it changes, once
  // hydrated - lets the caller persist it server-side (Task 5.1a) for
  // cross-device sync. Optional: reordering and its localStorage
  // persistence work fully without this, same as without persistenceKey.
  onOrderChange?: (order: string[]) => void;
}

// Coalesces a multi-card drag session (or several drags in quick succession)
// into a single write instead of one per card moved.
const SERVER_SYNC_DEBOUNCE_MS = 3_000;

const STORAGE_PREFIX = "guandan:hand-order:";

// jsdom (used by the component tests) doesn't implement
// requestAnimationFrame, so the FLIP reflow effect below falls back to a
// timeout there - the exact delay doesn't matter since jsdom's
// getBoundingClientRect always reports an all-zero rect anyway (no layout
// engine), which already makes that effect a no-op in tests.
const scheduleFrame: (callback: () => void) => void =
  typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? (callback) => window.requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16);

function baseOf(key: string): string {
  return key.slice(0, key.lastIndexOf("#"));
}

function handSignature(hand: CardWithWild[]): string {
  return hand.map((card) => encodeCard(card)).join(",");
}

// Reconciles a saved/previous visual order against the hand's actual
// contents. A double deck can hold two physically identical cards (same
// rank+suit, indistinguishable to the player), so "slot" identity is
// base-card + a sequence number, not array index. Keeps as many
// previously-tracked slots per card identity as still exist — earliest
// arranged first, so an untouched card is never displaced just because a
// different copy of the same card left the hand — and mints fresh slots for
// newly dealt/exchanged-in cards, with sequence numbers that only ever
// increase (never reused), so a brand-new slot can't collide with one still
// tracked.
function reconcileOrder(order: string[], hand: CardWithWild[]): string[] {
  const countByBase = new Map<string, number>();
  const firstSeenBases: string[] = [];
  for (const card of hand) {
    const base = encodeCard(card);
    if (!countByBase.has(base)) firstSeenBases.push(base);
    countByBase.set(base, (countByBase.get(base) ?? 0) + 1);
  }

  const previousSeqsByBase = new Map<string, number[]>();
  for (const key of order) {
    const base = baseOf(key);
    const seq = Number(key.slice(base.length + 1));
    const list = previousSeqsByBase.get(base);
    if (list) list.push(seq);
    else previousSeqsByBase.set(base, [seq]);
  }

  const kept: string[] = [];
  const keptCountByBase = new Map<string, number>();
  for (const key of order) {
    const base = baseOf(key);
    const total = countByBase.get(base) ?? 0;
    const already = keptCountByBase.get(base) ?? 0;
    if (already < total) {
      kept.push(key);
      keptCountByBase.set(base, already + 1);
    }
  }

  const added: string[] = [];
  for (const base of firstSeenBases) {
    const total = countByBase.get(base)!;
    let already = keptCountByBase.get(base) ?? 0;
    if (already >= total) continue;
    const previousSeqs = previousSeqsByBase.get(base) ?? [];
    let nextSeq = previousSeqs.length > 0 ? Math.max(...previousSeqs) + 1 : 0;
    for (; already < total; already++) {
      added.push(`${base}#${nextSeq}`);
      nextSeq++;
    }
  }

  return [...kept, ...added];
}

// Resolves an order of slot keys to concrete hand indices for rendering.
// Duplicate cards are assigned in the hand array's own encounter order —
// arbitrary among themselves, but inconsequential since they're visually
// and functionally identical (same rank+suit, no per-card server identity).
function resolveVisualOrder(
  orderKeys: string[],
  hand: CardWithWild[],
): { key: string; handIndex: number }[] {
  const indicesByBase = new Map<string, number[]>();
  hand.forEach((card, index) => {
    const base = encodeCard(card);
    const list = indicesByBase.get(base);
    if (list) list.push(index);
    else indicesByBase.set(base, [index]);
  });

  const cursorByBase = new Map<string, number>();
  const entries: { key: string; handIndex: number }[] = [];
  for (const key of orderKeys) {
    const base = baseOf(key);
    const indices = indicesByBase.get(base);
    const cursor = cursorByBase.get(base) ?? 0;
    if (!indices || cursor >= indices.length) continue;
    entries.push({ key, handIndex: indices[cursor] });
    cursorByBase.set(base, cursor + 1);
  }
  return entries;
}

function loadStoredOrder(persistenceKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + persistenceKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((key) => typeof key === "string")) return null;
    // Corrupted/hand-edited storage could contain a repeated literal key,
    // which would collide as a React list key and confuse reconciliation -
    // safer to distrust the whole value than to silently dedupe it.
    if (new Set(parsed).size !== parsed.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface Point {
  x: number;
  y: number;
}

interface MarqueeState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  // Captured once at pointerdown (rather than re-reading a ref during
  // render) so the overlay's position can be derived as a plain value.
  containerLeft: number;
  containerTop: number;
}

interface ClientRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectFromPoints(a: Point, b: Point): ClientRectLike {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

function rectsIntersect(a: ClientRectLike, b: ClientRectLike): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Player's hand: a grid of cards from the viewing player's own hand, with
// click-to-select, shift-click range select, marquee (rubber-band) box
// select, and drag-to-reorder/drag-to-move-selection via Pointer Events —
// used instead of the HTML5 drag-and-drop API since that has no reliable
// touch support, and Task 5.1a requires touch drag on mobile.
export default function PlayerHand({
  hand,
  isOwnHand = true,
  selectedIndices,
  onSelectionChange,
  persistenceKey,
  initialServerOrder,
  onOrderChange,
}: PlayerHandProps) {
  const [internalSelected, setInternalSelected] = useState<number[]>([]);
  const selected = selectedIndices ?? internalSelected;

  function applySelection(next: number[]) {
    if (onSelectionChange) onSelectionChange(next);
    else setInternalSelected(next);
  }

  const signature = handSignature(hand);
  // Natural (dealt) order by default - reading localStorage here would run
  // during the server-rendered first pass too and disagree with the client's
  // hydration (same pitfall GameProvider's playerId documents), so the
  // persisted order is loaded in an effect below instead, after mount.
  const [orderKeys, setOrderKeys] = useState<string[]>(() => reconcileOrder([], hand));
  // Detects a hand-shape change (cards played/dealt) during render, the same
  // "adjust state from props" pattern used for wildActsAsByIndex in
  // app/game/[id]/page.tsx, rather than an effect that would let one stale
  // render slip through with a since-removed card still in the order.
  const [reconciledFor, setReconciledFor] = useState(signature);
  if (reconciledFor !== signature) {
    setReconciledFor(signature);
    setOrderKeys((prev) => reconcileOrder(prev, hand));
  }

  // Gates the persist-write effect below until the load effect has had a
  // chance to run - without this, mount would write the pre-load natural
  // order to storage a beat before overwriting it with the real persisted
  // order (harmless once settled, but a real spurious write, and a narrow
  // window for a concurrent second tab to read the wrong value from it).
  // Set via the same effect that calls setOrderKeys, so both updates land in
  // one batched re-render and the write below only ever fires once, already
  // holding the reconciled value.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!persistenceKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-sync gate, see comment above
      setHydrated(true);
      return;
    }
    // localStorage always wins over the server's copy when both exist - it
    // reflects whatever this exact device was most recently showing, while
    // the server value only catches up after the debounced sync effect
    // below next fires. The server value's only job is covering a device
    // that has never saved anything locally for this persistenceKey yet.
    const seed = loadStoredOrder(persistenceKey) ?? initialServerOrder;
    if (seed && seed.length > 0) {
      setOrderKeys(reconcileOrder(seed, hand));
    }
    setHydrated(true);
    // Deliberately only on mount / when switching to a different persisted
    // key (a different game or seat) - re-running this on every hand change
    // would clobber an in-session drag with the now-stale stored order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceKey]);

  useEffect(() => {
    if (!persistenceKey || !hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + persistenceKey, JSON.stringify(orderKeys));
    } catch {
      // Storage full/disabled/private-mode - reordering still works for this
      // session, it just won't survive a refresh.
    }
  }, [persistenceKey, hydrated, orderKeys]);

  // Debounced server sync for cross-device persistence (Task 5.1a) - the
  // localStorage effect above is the one that has to be synchronous/instant
  // (same-device continuity can't wait on a network round trip), so this is
  // purely a best-effort background mirror of it. Gated on `hydrated` for
  // the same reason as the write above: an unhydrated `orderKeys` is still
  // the pre-load natural order, not yet reconciled against whatever was
  // loaded, so syncing it would risk overwriting a real saved order with a
  // stale default before the load effect even runs.
  useEffect(() => {
    if (!hydrated || !onOrderChange) return;
    const timeout = setTimeout(() => onOrderChange(orderKeys), SERVER_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [hydrated, orderKeys, onOrderChange]);

  // Tracked by slot key rather than visual index/position (Task 5.1b): a
  // multi-card group drag needs a stable way to identify "the cards being
  // dragged" that survives the array splicing every hover-crossing below
  // triggers, which a position-based index can't offer once more than one
  // card is moving at once.
  const [draggingKeys, setDraggingKeys] = useState<string[] | null>(null);
  // Sits outside React state because it must be readable synchronously by a
  // native click event that fires immediately after pointerup, in the same
  // gesture - a state update wouldn't commit in time.
  const justDraggedRef = useRef(false);
  // Pointerdown client position for the active drag, and the live delta
  // from it - drives the "lift and follow the pointer" animation on the
  // dragged card(s) below. Kept separate from draggingKeys so a drag's
  // origin survives the array reorders that replace `orderKeys` mid-drag.
  const dragOriginRef = useRef<Point | null>(null);
  const [dragDelta, setDragDelta] = useState<Point>({ x: 0, y: 0 });

  // Slot key of the last plain-clicked (non-shift) card - the range anchor
  // for shift-click select, same "identity by slot key" system as
  // orderKeys, so it survives a reorder or a card leaving the hand (in
  // which case shift-click just falls back to selecting the clicked card,
  // see handleCardClick).
  const anchorKeyRef = useRef<string | null>(null);

  // Rubber-band box select: null when idle, otherwise the drag's live
  // extent in viewport coordinates (Task 5.1b).
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  // FLIP reflow: measured slot positions after the most recent render, so
  // the next reorder can compute how far each (non-dragged) slot moved and
  // animate it sliding into place instead of popping - flex-wrap reordering
  // changes DOM position, not a `transform`, so nothing animates on its own
  // without this.
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRectsRef = useRef<Map<string, ClientRectLike>>(new Map());
  // Always holds the latest render's visual order - the marquee's
  // window-level listeners below live for the whole drag gesture, so if
  // `hand`/`orderKeys` change mid-gesture (a play resolving, a server hand
  // update landing, mid-marquee), reading this ref instead of a value
  // closed over at gesture start keeps hit-testing against the current
  // hand instead of one that may no longer match `hand[handIndex]`.
  const visualEntriesRef = useRef<{ key: string; handIndex: number }[]>([]);

  function toggleCard(handIndex: number) {
    if (onSelectionChange) {
      const next = selected.includes(handIndex)
        ? selected.filter((i) => i !== handIndex)
        : [...selected, handIndex];
      onSelectionChange(next);
    } else {
      // Functional update (not derived from the `selected` closure) so two
      // toggles of the same card fired in the same React batch (e.g. a
      // rapid double-click, both handlers running before either commits a
      // re-render) correctly cancel out instead of both reading the same
      // stale pre-toggle value.
      setInternalSelected((prev) =>
        prev.includes(handIndex) ? prev.filter((i) => i !== handIndex) : [...prev, handIndex]
      );
    }
  }

  function handleCardClick(
    event: React.MouseEvent<HTMLButtonElement>,
    handIndex: number,
    key: string,
    visualEntries: { key: string; handIndex: number }[],
  ) {
    if (event.shiftKey) {
      const clickedVisualIndex = visualEntries.findIndex((entry) => entry.key === key);
      const anchorVisualIndex = anchorKeyRef.current
        ? visualEntries.findIndex((entry) => entry.key === anchorKeyRef.current)
        : -1;
      // No anchor yet (nothing plain-clicked this session) or the anchor
      // card is no longer in the hand (e.g. played) - shift-click degrades
      // to selecting just the clicked card, same as a plain click would.
      const start = anchorVisualIndex === -1 ? clickedVisualIndex : anchorVisualIndex;
      const [from, to] =
        start <= clickedVisualIndex ? [start, clickedVisualIndex] : [clickedVisualIndex, start];
      applySelection(visualEntries.slice(from, to + 1).map((entry) => entry.handIndex));
      return;
    }
    anchorKeyRef.current = key;
    toggleCard(handIndex);
  }

  function handlePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    key: string,
    handIndex: number,
    visualEntries: { key: string; handIndex: number }[],
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Deliberately no setPointerCapture here (only every card's own
    // onPointerMove, all wired to this same handler, is relied on instead):
    // per spec, capturing a pointer also redirects the compatibility mouse
    // events that follow - including the trailing "click" - to the
    // capturing element. Since that element is this wrapper div, not the
    // Card <button> inside it, a captured gesture's click would fire on the
    // div (no onClick) instead of the button, silently breaking
    // click-to-select for every click, not just drags. Capture isn't needed
    // for correctness anyway: mouse pointermove naturally fires on whatever
    // slot is currently under the cursor (its own listener, same shared
    // handler), and touch pointers are implicitly target-locked to their
    // origin element for the whole gesture per spec regardless.
    justDraggedRef.current = false;
    dragOriginRef.current = { x: event.clientX, y: event.clientY };
    setDragDelta({ x: 0, y: 0 });
    // Dragging a card that's part of a multi-card selection moves the whole
    // selection together, in its current visual order; dragging anything
    // else (an unselected card, or a lone selected one) only moves that one
    // card - unchanged from the pre-multiselect behavior.
    const group =
      selected.length > 1 && selected.includes(handIndex)
        ? visualEntries.filter((entry) => selected.includes(entry.handIndex)).map((entry) => entry.key)
        : [key];
    setDraggingKeys(group);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (draggingKeys === null) return;
    if (event.buttons === 0) {
      // The primary button/touch contact is no longer held - the pointer
      // was released outside every card slot (no local pointerup/cancel
      // fired to end the drag; the window-level listener below is the
      // primary defense, this is a cheap belt-and-suspenders check so a
      // stray hover afterward can't keep silently reordering cards).
      endDrag();
      return;
    }
    if (dragOriginRef.current) {
      setDragDelta({
        x: event.clientX - dragOriginRef.current.x,
        y: event.clientY - dragOriginRef.current.y,
      });
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const hovered = hit instanceof Element ? hit.closest<HTMLElement>("[data-key]") : null;
    const hoveredKey = hovered?.dataset.key;
    // No target, or hovering over a slot that's already part of the dragged
    // group, is a no-op - only a real cross-slot move counts as "dragged"
    // for click-suppression purposes, same as the single-card case.
    if (!hoveredKey || draggingKeys.includes(hoveredKey)) return;
    justDraggedRef.current = true;
    setOrderKeys((prev) => {
      const remaining = prev.filter((existingKey) => !draggingKeys.includes(existingKey));
      const hoveredRemainingIndex = remaining.indexOf(hoveredKey);
      if (hoveredRemainingIndex === -1) return prev;
      // Whether the hovered slot was originally ahead of or behind the
      // dragged group decides which side of it the group lands on - matches
      // the single-card drag's existing feel (swap into the hovered slot,
      // displacing it toward where the drag came from) and, unlike always
      // inserting on a fixed side, generalizes correctly to a multi-card
      // group instead of collapsing every hover onto one edge of the hand
      // once the group spans more than one removed slot. Uses the group's
      // own leading edge (its lowest original index), not whichever member
      // happened to be grabbed - two different cards in the same selection
      // dragged to the same hovered slot must produce the same result.
      const groupOriginIndex = Math.min(...draggingKeys.map((k) => prev.indexOf(k)));
      const hoveredOriginalIndex = prev.indexOf(hoveredKey);
      const insertAt =
        hoveredOriginalIndex > groupOriginIndex ? hoveredRemainingIndex + 1 : hoveredRemainingIndex;
      return [...remaining.slice(0, insertAt), ...draggingKeys, ...remaining.slice(insertAt)];
    });
  }

  function endDrag() {
    setDraggingKeys(null);
    dragOriginRef.current = null;
    setDragDelta({ x: 0, y: 0 });
  }

  // Without pointer capture (see handlePointerDown), a mouse release outside
  // every card slot - e.g. dragging up into the score board above the hand,
  // a perfectly natural gesture - would never fire any slot's onPointerUp,
  // leaving the drag stuck. A window-level listener guarantees the drag
  // always ends wherever the pointer actually comes up.
  useEffect(() => {
    if (draggingKeys === null) return;
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
    // Only the active/inactive transition needs to (re)install the
    // listeners - `endDrag` is stable across renders in everything that
    // matters (it doesn't close over per-render values).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingKeys !== null]);

  // A real drag ends with the browser firing a trailing click on whichever
  // card the pointer was released over - without this, dropping a dragged
  // card on top of another would also toggle that other card's selection.
  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (justDraggedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      justDraggedRef.current = false;
    }
  }

  function computeMarqueeHits(
    rect: ClientRectLike,
    visualEntries: { key: string; handIndex: number }[],
  ): number[] {
    const hits: number[] = [];
    for (const entry of visualEntries) {
      const el = slotRefs.current.get(entry.key);
      if (el && rectsIntersect(rect, el.getBoundingClientRect())) hits.push(entry.handIndex);
    }
    return hits;
  }

  function handleContainerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Only a press directly on the panel's empty space starts a marquee -
    // a press that bubbled up from a card slot (its target is deep inside
    // that slot, not this container) is a card drag/click instead, already
    // handled by handlePointerDown above.
    if (event.target !== event.currentTarget) return;
    const containerRect = event.currentTarget.getBoundingClientRect();
    const start: Point = { x: event.clientX, y: event.clientY };
    // Bound to this gesture's specific pointer so a second, unrelated
    // pointer touching down mid-marquee (e.g. an accidental second touch
    // point on mobile) can't feed its moves into this one.
    const pointerId = event.pointerId;
    setMarquee({
      startX: start.x,
      startY: start.y,
      curX: start.x,
      curY: start.y,
      containerLeft: containerRect.left,
      containerTop: containerRect.top,
    });
    // Selecting nothing yet (zero-size box) - live updates take over from
    // here as the pointer moves, via the window-level listener below.
    applySelection([]);

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      const cur: Point = { x: moveEvent.clientX, y: moveEvent.clientY };
      setMarquee((prev) => (prev ? { ...prev, curX: cur.x, curY: cur.y } : prev));
      // Reads the ref rather than the `visualEntries` closed over above, so
      // a hand change mid-drag (a play resolving, a server update landing)
      // is reflected immediately instead of hit-testing a stale mapping.
      applySelection(computeMarqueeHits(rectFromPoints(start, cur), visualEntriesRef.current));
    }
    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      setMarquee(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    }
    // Same rationale as card drag's window-level fallback above: without
    // pointer capture, a marquee that's dragged past the panel's edge would
    // stop receiving move/up events from the panel itself.
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  // FLIP reflow for every reorder (drag-triggered or a hand-shape change
  // filling a gap): compares each non-dragged slot's position just before
  // this render to where it landed just after, and if it moved, animates
  // from the old position to the new one instead of letting it pop.
  // Dragged slots are skipped here - their position is driven by the
  // pointer-follow transform below instead, and comparing their rect while
  // that transform is active would (harmlessly) produce a "settle back into
  // place" animation on drop, since prevRects captured a lifted position.
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    const draggingSet = new Set(draggingKeys ?? []);
    slotRefs.current.forEach((el, key) => {
      if (draggingSet.has(key)) return;
      const prev = prevRects.get(key);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Forces the browser to paint the "from" position above before the
      // rAF below clears it - otherwise the transform-to-none change would
      // be coalesced into the same frame and never visibly transition.
      el.getBoundingClientRect();
      scheduleFrame(() => {
        el.style.transition = "";
        el.style.transform = "";
      });
    });

    const nextRects = new Map<string, ClientRectLike>();
    slotRefs.current.forEach((el, key) => {
      const rect = el.getBoundingClientRect();
      // A dragging slot's own measured rect includes the pointer-follow
      // transform's offset (see the style block below) - recording that
      // directly would bake today's arbitrary lift position in as this
      // card's baseline, producing a bogus slide-in animation from a
      // position it never rested at the next time some *other* reorder
      // moves it. Subtracting the known live delta recovers its actual
      // resting position in the grid, same as every non-dragging slot's
      // rect already reflects.
      nextRects.set(
        key,
        draggingSet.has(key)
          ? {
              left: rect.left - dragDelta.x,
              top: rect.top - dragDelta.y,
              right: rect.right - dragDelta.x,
              bottom: rect.bottom - dragDelta.y,
            }
          : rect,
      );
    });
    prevRectsRef.current = nextRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKeys]);

  const visualEntries = resolveVisualOrder(orderKeys, hand);
  // Refs can't be written during render (React lint rule) - this mirrors it
  // into visualEntriesRef right after commit instead, so it's still ready
  // before any event (including a pointermove that lands in the same
  // frame) can read it.
  useLayoutEffect(() => {
    visualEntriesRef.current = visualEntries;
  }, [visualEntries]);

  if (!isOwnHand) {
    return (
      <div data-testid="player-hand-hidden" className="flex gap-1">
        {hand.map((_, index) => (
          <div
            key={index}
            data-testid="card-back"
            className="h-20 w-14 rounded-lg border-2 border-emerald-950 bg-emerald-700 sm:h-24 sm:w-16"
          />
        ))}
      </div>
    );
  }

  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.startX, marquee.curX) - marquee.containerLeft,
        top: Math.min(marquee.startY, marquee.curY) - marquee.containerTop,
        width: Math.abs(marquee.curX - marquee.startX),
        height: Math.abs(marquee.curY - marquee.startY),
      }
    : null;

  return (
    <div
      data-testid="player-hand"
      // w-full (not shrink-wrapped to the cards) so there's real empty
      // panel space to start a marquee drag from - this sits inside a
      // `flex-col items-start` parent (app/game/[id]/page.tsx), which
      // shrink-wraps auto-width flex children to their content, leaving
      // next to no background to click without this.
      className="relative flex w-full flex-wrap gap-1"
      onClickCapture={handleClickCapture}
      onPointerDown={handleContainerPointerDown}
    >
      {visualEntries.map(({ key, handIndex }) => {
        const isDragging = draggingKeys?.includes(key) ?? false;
        // Real movement, not just "a pointer is currently down on this
        // card" - pointerdown alone (a stationary click) must leave this
        // slot hit-testable, or the browser's native pointerup/click ends
        // up targeting whatever's beneath it (here, the panel background)
        // instead of the card button, silently breaking every plain click
        // in a real browser. jsdom's fireEvent dispatches straight at a
        // target regardless of pointer-events, so this only ever showed up
        // testing an actual rendered page.
        const isActivelyDragging = isDragging && (dragDelta.x !== 0 || dragDelta.y !== 0);
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) slotRefs.current.set(key, el);
              else slotRefs.current.delete(key);
            }}
            data-testid="hand-card-slot"
            data-key={key}
            style={{
              touchAction: "none",
              userSelect: "none",
              ...(isDragging
                ? {
                    transform: `translate(${dragDelta.x}px, ${dragDelta.y}px) scale(1.06)`,
                    zIndex: 30,
                    ...(isActivelyDragging
                      ? // Lets elementFromPoint hit-test the slot underneath
                        // the lifted card instead of the lifted card itself.
                        { pointerEvents: "none" as const }
                      : undefined),
                  }
                : undefined),
            }}
            className={
              isDragging
                ? // No `transform` in this transition-property: the dragged
                  // slot's transform is driven directly every pointermove
                  // (see handlePointerMove) and must track the pointer with
                  // zero lag, not ease toward it.
                  "shadow-xl transition-[box-shadow] duration-150 ease-out"
                : // Covers the FLIP reflow effect below, which drives this
                  // slot's transform imperatively (set, then cleared next
                  // frame) whenever a reorder displaces it.
                  "transition-[transform,box-shadow] duration-200 ease-out"
            }
            onPointerDown={(event) => handlePointerDown(event, key, handIndex, visualEntries)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <Card
              card={hand[handIndex]}
              selected={selected.includes(handIndex)}
              onClick={(event) => handleCardClick(event, handIndex, key, visualEntries)}
            />
          </div>
        );
      })}
      {marqueeRect && (
        <div
          data-testid="marquee-select-box"
          className="pointer-events-none absolute z-40 rounded-sm border border-blue-400 bg-blue-400/20"
          style={marqueeRect}
        />
      )}
    </div>
  );
}
