"use client";

import { useEffect, useRef, useState } from "react";
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
const SERVER_SYNC_DEBOUNCE_MS = 800;

const STORAGE_PREFIX = "guandan:hand-order:";

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

// Player's hand: a grid of cards from the viewing player's own hand, with
// click-to-select and (when own hand) drag-to-reorder via Pointer Events —
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

  const [draggingVisualIndex, setDraggingVisualIndex] = useState<number | null>(null);
  // Sits outside React state because it must be readable synchronously by a
  // native click event that fires immediately after pointerup, in the same
  // gesture - a state update wouldn't commit in time.
  const justDraggedRef = useRef(false);

  function toggleCard(index: number) {
    if (onSelectionChange) {
      const next = selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index];
      onSelectionChange(next);
    } else {
      setInternalSelected((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      );
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>, visualIndex: number) {
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
    setDraggingVisualIndex(visualIndex);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (draggingVisualIndex === null) return;
    if (event.buttons === 0) {
      // The primary button/touch contact is no longer held - the pointer
      // was released outside every card slot (no local pointerup/cancel
      // fired to end the drag; the window-level listener below is the
      // primary defense, this is a cheap belt-and-suspenders check so a
      // stray hover afterward can't keep silently reordering cards).
      setDraggingVisualIndex(null);
      return;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const hovered = hit instanceof Element ? hit.closest<HTMLElement>("[data-visual-index]") : null;
    if (!hovered) return;
    const hoveredIndex = Number(hovered.dataset.visualIndex);
    if (Number.isNaN(hoveredIndex) || hoveredIndex === draggingVisualIndex) return;
    // Only a real cross-slot move counts as "dragged" for click-suppression
    // purposes - a card's own footprint (tens of pixels) already absorbs a
    // plain click's jitter, so nothing extra is needed to tell a tap from a
    // drag here.
    justDraggedRef.current = true;
    setOrderKeys((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggingVisualIndex, 1);
      next.splice(hoveredIndex, 0, moved);
      return next;
    });
    setDraggingVisualIndex(hoveredIndex);
  }

  function endDrag() {
    setDraggingVisualIndex(null);
  }

  // Without pointer capture (see handlePointerDown), a mouse release outside
  // every card slot - e.g. dragging up into the score board above the hand,
  // a perfectly natural gesture - would never fire any slot's onPointerUp,
  // leaving draggingVisualIndex stuck. A window-level listener guarantees
  // the drag always ends wherever the pointer actually comes up.
  useEffect(() => {
    if (draggingVisualIndex === null) return;
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [draggingVisualIndex]);

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

  const visualEntries = resolveVisualOrder(orderKeys, hand);

  return (
    <div data-testid="player-hand" className="flex flex-wrap gap-1" onClickCapture={handleClickCapture}>
      {visualEntries.map(({ key, handIndex }, visualIndex) => (
        <div
          key={key}
          data-testid="hand-card-slot"
          data-visual-index={visualIndex}
          style={{ touchAction: "none", userSelect: "none" }}
          className={draggingVisualIndex === visualIndex ? "opacity-60" : undefined}
          onPointerDown={(event) => handlePointerDown(event, visualIndex)}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Card
            card={hand[handIndex]}
            selected={selected.includes(handIndex)}
            onClick={() => toggleCard(handIndex)}
          />
        </div>
      ))}
    </div>
  );
}
