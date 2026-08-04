"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
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

// Exposed so an ancestor (app/game/[id]/page.tsx) can extend marquee
// box-select's hit area beyond PlayerHand's own tightly-wrapped bounds -
// e.g. to the whole cards+buttons panel - without PlayerHand needing to
// know anything about what else is on the page. The ancestor owns deciding
// *when* an empty-space press should start a marquee (its own pointerdown
// handler); PlayerHand still owns everything about *how* one behaves (hit-
// testing against its own cards, the overlay, the selection callback).
export interface PlayerHandHandle {
  startMarqueeFrom: (event: { clientX: number; clientY: number; pointerId: number }) => void;
}

export function remapCardIndices(
  previousHand: CardWithWild[],
  nextHand: CardWithWild[],
  selectedIndices: number[],
): number[] {
  const usedNextIndices = new Set<number>();
  const remapped: number[] = [];
  for (const previousIndex of selectedIndices) {
    const previousCard = previousHand[previousIndex];
    if (!previousCard) continue;
    const nextIndex = nextHand.findIndex(
      (card, index) =>
        !usedNextIndices.has(index) && encodeCard(card) === encodeCard(previousCard),
    );
    if (nextIndex === -1) continue;
    usedNextIndices.add(nextIndex);
    remapped.push(nextIndex);
  }
  return remapped;
}

// Shared by the real game page and the DB-free previews. A press on a card or
// action button belongs to that control; an empty panel press is the only
// thing the ancestor should forward to PlayerHand for marquee selection.
export function isHandPanelControlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    Boolean(target.closest('[data-key], button, [data-testid="player-hand"]'));
}

export function startHandPanelMarquee(
  event: React.PointerEvent<HTMLDivElement>,
  playerHandRef: { current: PlayerHandHandle | null },
) {
  if (isTouchFirstDevice()) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (isHandPanelControlTarget(event.target)) return;
  playerHandRef.current?.startMarqueeFrom(event);
}

// Coalesces a multi-card drag session (or several drags in quick succession)
// into a single write instead of one per card moved.
const SERVER_SYNC_DEBOUNCE_MS = 3_000;

const STORAGE_PREFIX = "guandan:hand-order:";

// A press must move the pointer further than this (in either axis combined,
// via distance) before it counts as a drag rather than a click - without a
// deadzone, the sub-pixel jitter real mice/trackpads produce even during a
// stationary press would flip a card into "dragging" visuals for a single
// frame, which is enough to make its native pointerup/click land on
// whatever's underneath it instead of the card itself (see the drag-state
// render logic below).
const DRAG_ACTIVATION_THRESHOLD_PX = 4;

// PlayerHand's `gap-1` is 0.25rem (4px at the browser's default root size).
// The computed value is used when available so a customized root font size
// still packs a floating multi-card group exactly like the hand grid; this is
// only the safe fallback for layout-less test environments.
const HAND_GAP_FALLBACK_PX = 4;

// On touch-first devices, empty-panel drags compete with normal page
// scrolling and make a marquee far too imprecise to be useful. This checks
// input capability rather than viewport width, so a narrow desktop window
// keeps its mouse/trackpad marquee behavior. Card slots retain `touch-action:
// none`, so touch drag-and-drop remains available without the selection box.
const TOUCH_FIRST_DEVICE_QUERY = "(hover: none) and (pointer: coarse)";

function isTouchFirstDevice(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(TOUCH_FIRST_DEVICE_QUERY).matches;
}

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
const PlayerHand = forwardRef<PlayerHandHandle, PlayerHandProps>(function PlayerHand(
  {
    hand,
    isOwnHand = true,
    selectedIndices,
    onSelectionChange,
    persistenceKey,
    initialServerOrder,
    onOrderChange,
  },
  ref,
) {
  const [internalSelected, setInternalSelected] = useState<number[]>([]);
  const selected = selectedIndices ?? internalSelected;

  function applySelection(next: number[]) {
    if (onSelectionChange) onSelectionChange(next);
    else setInternalSelected(next);
  }

  const signature = handSignature(hand);
  const [selectionHand, setSelectionHand] = useState(hand);
  const [selectionSignature, setSelectionSignature] = useState(signature);
  if (selectionSignature !== signature) {
    const remapped = remapCardIndices(selectionHand, hand, internalSelected);
    setSelectionHand(hand);
    setSelectionSignature(signature);
    if (selectedIndices === undefined) setInternalSelected(remapped);
  }
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

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Tracked by slot key rather than visual index/position (Task 5.1b): a
  // multi-card group drag needs a stable way to identify "the cards being
  // dragged" that survives reordering, which a position-based index can't
  // offer once more than one card is moving at once. Mirrored into a ref for
  // the same stale-window-listener-closure reason as dragDelta/dropIndex
  // below - endDrag additionally uses the ref as a single-execution guard
  // (see endDrag), since it can otherwise be invoked twice for one release
  // (the container's own onPointerUp, and the window-level fallback, both
  // firing for the same native event).
  const [draggingKeys, setDraggingKeysState] = useState<string[] | null>(null);
  const draggingKeysRef = useRef<string[] | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const marqueePointerIdRef = useRef<number | null>(null);
  function setDraggingKeys(next: string[] | null) {
    draggingKeysRef.current = next;
    setDraggingKeysState(next);
  }
  // Sits outside React state because it must be readable synchronously by a
  // native click event that fires immediately after pointerup, in the same
  // gesture - a state update wouldn't commit in time.
  const justDraggedRef = useRef(false);
  // Pointerdown client position for the active drag, and the live delta
  // from it - drives the floating drag overlay below. `dragDelta` is also
  // mirrored into a ref: `endDrag` is registered as a window listener whose
  // *closure* is only refreshed when a drag starts/ends (see the effect
  // below), so reading the state value directly from inside it could see a
  // stale pre-drag delta - the ref is always current regardless of which
  // closure ends up invoked.
  const dragOriginRef = useRef<Point | null>(null);
  const [dragDelta, setDragDeltaState] = useState<Point>({ x: 0, y: 0 });
  const dragDeltaRef = useRef<Point>({ x: 0, y: 0 });
  function setDragDelta(next: Point) {
    dragDeltaRef.current = next;
    setDragDeltaState(next);
  }

  // Where the dragged group would land if dropped right now - an index into
  // the *other* (non-dragged) cards' visual order. Reorder is deferred
  // until drop (see endDrag): while dragging, this only ever affects where
  // the group would land, never the underlying order. The visible dashed
  // gap marks that one logical drop position, while invisible spacers reserve
  // one grid slot per dragged card so the wrapped hand never changes height.
  // Same stale-closure concern as dragDelta above, same fix (a
  // mirrored ref for endDrag to read).
  const [dropIndex, setDropIndexState] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  function setDropIndex(next: number | null) {
    dropIndexRef.current = next;
    setDropIndexState(next);
  }

  // The grabbed card's own on-screen rect at drag start, and each dragged
  // card's offset from it - together they let the floating overlay
  // reproduce the group's original relative spacing while it follows the
  // pointer, without needing any of them to stay mounted in the grid.
  const dragStartRectRef = useRef<ClientRectLike | null>(null);
  const dragOffsetsRef = useRef<Map<string, Point>>(new Map());
  // The dragged group's own starting position, expressed the same way as
  // dropIndexRef (an index among the *other* cards) - lets endDrag tell a
  // real reorder apart from a drag that's released back where it started,
  // so a no-op drop can skip the reorder commit and its FLIP fly-back
  // instead of refreshing the whole hand for nothing.
  const dragStartIndexRef = useRef<number | null>(null);

  // Respect the user's OS-level motion preference for both the FLIP settle
  // animation and the lifted-card scale. The initial false value keeps the
  // server/client render identical; the effect updates it immediately after
  // mount in a browser.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

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
  // the next reorder can compute how far each slot moved and animate it
  // sliding into place instead of popping - flex-wrap reordering changes
  // DOM position, not a `transform`, so nothing animates on its own without
  // this. Dragged cards are never in `slotRefs` while actively dragging
  // (see the render logic below), so this naturally only ever covers
  // settled, non-floating cards - including, once `endDrag` below seeds a
  // synthetic "last floating position" baseline for them, the cards that
  // were just dropped.
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

  function selectKeyboardRange(
    key: string,
    visualEntries: { key: string; handIndex: number }[],
    targetKey: string,
  ) {
    const anchorKey = anchorKeyRef.current ?? key;
    const anchorIndex = visualEntries.findIndex((entry) => entry.key === anchorKey);
    const targetIndex = visualEntries.findIndex((entry) => entry.key === targetKey);
    if (anchorIndex === -1 || targetIndex === -1) return;
    const [from, to] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    applySelection(visualEntries.slice(from, to + 1).map((entry) => entry.handIndex));
  }

  function handleCardPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    key: string,
    handIndex: number,
    visualEntries: { key: string; handIndex: number }[],
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragPointerIdRef.current !== null || marqueePointerIdRef.current !== null) return;
    // Deliberately no setPointerCapture here: per spec, capturing a pointer
    // also redirects the compatibility mouse events that follow - including
    // the trailing "click" - to the capturing element. Since that element
    // is this wrapper div, not the Card <button> inside it, a captured
    // gesture's click would fire on the div (no onClick) instead of the
    // button, silently breaking click-to-select for every click, not just
    // drags. Capture isn't needed for correctness anyway: the container's
    // own onPointerMove (below) naturally keeps receiving events for the
    // whole gesture regardless of which element is currently under the
    // pointer, and touch pointers are implicitly target-locked to their
    // origin element for the whole gesture per spec regardless.
    justDraggedRef.current = false;
    dragPointerIdRef.current = event.pointerId;
    dragOriginRef.current = { x: event.clientX, y: event.clientY };
    setDragDelta({ x: 0, y: 0 });

    // Dragging a card that's part of a multi-card selection moves the whole
    // selection together, in its current visual order; dragging anything
    // else (an unselected card, or a lone selected one) only moves that one
    // card.
    const group =
      selected.length > 1 && selected.includes(handIndex)
        ? visualEntries.filter((entry) => selected.includes(entry.handIndex)).map((entry) => entry.key)
        : [key];

    const grabbedRect = event.currentTarget.getBoundingClientRect();
    dragStartRectRef.current = {
      left: grabbedRect.left,
      top: grabbedRect.top,
      right: grabbedRect.right,
      bottom: grabbedRect.bottom,
    };
    // A non-adjacent selection becomes a contiguous block when it is moved.
    // Pack the floating cards to match the contiguous placeholder footprint
    // instead of retaining their old, non-adjacent screen offsets - otherwise
    // a floating card can sit on top of an unselected card that just reflowed
    // into the selection's former gap.
    const container = containerRef.current;
    const computedStyle = container ? window.getComputedStyle(container) : null;
    const configuredColumnGap = computedStyle
      ? Number.parseFloat(computedStyle.columnGap)
      : Number.NaN;
    const configuredRowGap = computedStyle
      ? Number.parseFloat(computedStyle.rowGap)
      : Number.NaN;
    const columnGap = Number.isFinite(configuredColumnGap)
      ? configuredColumnGap
      : HAND_GAP_FALLBACK_PX;
    const rowGap = Number.isFinite(configuredRowGap)
      ? configuredRowGap
      : HAND_GAP_FALLBACK_PX;
    const cardWidth = grabbedRect.right - grabbedRect.left;
    const cardHeight = grabbedRect.bottom - grabbedRect.top;
    const visualKeys = visualEntries.map((entry) => entry.key);
    const grabbedVisualIndex = visualKeys.indexOf(key);
    // The packed group begins wherever the grabbed card stays in its original
    // grid slot. Counting only non-dragged cards before it supplies that
    // insertion index among `remaining` cards.
    const startIndex = visualKeys
      .slice(0, grabbedVisualIndex)
      .filter((candidate) => !group.includes(candidate)).length;
    const containerWidth = container?.getBoundingClientRect().width ?? 0;
    const columns = cardWidth > 0
      ? Math.max(1, Math.floor((containerWidth + columnGap) / (cardWidth + columnGap)))
      : 1;
    const grabbedGroupIndex = group.indexOf(key);
    const grabbedPackedIndex = startIndex + grabbedGroupIndex;
    const grabbedRow = Math.floor(grabbedPackedIndex / columns);
    const grabbedColumn = grabbedPackedIndex % columns;
    const offsets = new Map<string, Point>();
    for (const [groupIndex, groupKey] of group.entries()) {
      const packedIndex = startIndex + groupIndex;
      const packedRow = Math.floor(packedIndex / columns);
      const packedColumn = packedIndex % columns;
      offsets.set(groupKey, {
        x: (packedColumn - grabbedColumn) * (cardWidth + columnGap),
        y: (packedRow - grabbedRow) * (cardHeight + rowGap),
      });
    }
    dragOffsetsRef.current = offsets;

    // Where the contiguous group starts, translated into an index among the
    // *other* cards. It is chosen so the grabbed card keeps its original grid
    // position as a non-adjacent selection is packed into one block, avoiding
    // both a pointer jump and overlap with the reflowed unselected cards.
    dragStartIndexRef.current = startIndex;
    setDropIndex(startIndex);

    setDraggingKeys(group);
  }

  function updateDragPointer(
    clientX: number,
    clientY: number,
    buttons: number,
    pointerId: number,
  ) {
    if (draggingKeysRef.current === null || dragPointerIdRef.current !== pointerId) return;
    if (buttons === 0) {
      // The primary button/touch contact is no longer held - the pointer
      // was released outside the panel (no local pointerup/cancel fired to
      // end the drag; the window-level listener below is the primary
      // defense, this is a cheap belt-and-suspenders check so a stray hover
      // afterward can't keep silently updating the drop target).
      endDrag(false, pointerId);
      return;
    }
    if (!dragOriginRef.current) return;
    const newDelta = {
      x: clientX - dragOriginRef.current.x,
      y: clientY - dragOriginRef.current.y,
    };
    setDragDelta(newDelta);
    // Below the activation threshold, the pressed card is still rendered
    // normally in the grid (see the render logic below) - deliberately
    // don't touch justDraggedRef/dropIndex yet, so a press that never moves
    // enough to count as a drag behaves as a plain, unmodified click.
    if (Math.hypot(newDelta.x, newDelta.y) <= DRAG_ACTIVATION_THRESHOLD_PX) return;
    justDraggedRef.current = true;

    const hit = document.elementFromPoint(clientX, clientY);
    const hoveredSlot = hit instanceof Element ? hit.closest<HTMLElement>("[data-key]") : null;
    const hoveredKey = hoveredSlot?.dataset.key;
    // No target (e.g. hovering the placeholder gap, or empty panel space)
    // is a no-op - the drop target simply stays wherever it last was.
    if (!hoveredKey || !hoveredSlot) return;
    const draggingGroup = draggingKeysRef.current;
    const currentKeys = visualEntriesRef.current.map((entry) => entry.key);
    const remaining = currentKeys.filter((k) => !draggingGroup.includes(k));
    const hoveredIndex = remaining.indexOf(hoveredKey);
    if (hoveredIndex === -1) return;
    const rect = hoveredSlot.getBoundingClientRect();
    const insertAfter = clientX > rect.left + rect.width / 2;
    setDropIndex(insertAfter ? hoveredIndex + 1 : hoveredIndex);
  }

  function endDrag(cancelled = false, pointerId?: number) {
    if (pointerId !== undefined && dragPointerIdRef.current !== pointerId) return;
    const group = draggingKeysRef.current;
    // Already ended by whichever of the container's own onPointerUp or the
    // window-level fallback listener (see the effect below) fired first for
    // this release - guards against running the commit logic below twice
    // for the same drop.
    if (group === null) return;
    draggingKeysRef.current = null;

    if (
      !cancelled &&
      justDraggedRef.current &&
      dropIndexRef.current !== null &&
      dropIndexRef.current !== dragStartIndexRef.current
    ) {
      const finalDropIndex = dropIndexRef.current;
      // Seeds this render's FLIP baseline for each dropped card to its last
      // floating position, computed the same way the overlay below renders
      // it - so instead of popping into its final slot, it's picked up by
      // the same "animate from previous rect" effect that already handles
      // every other displaced card, and visibly flies in from wherever it
      // was actually hovering.
      const startRect = dragStartRectRef.current;
      if (startRect) {
        const width = startRect.right - startRect.left;
        const height = startRect.bottom - startRect.top;
        for (const groupKey of group) {
          const offset = dragOffsetsRef.current.get(groupKey) ?? { x: 0, y: 0 };
          const left = startRect.left + dragDeltaRef.current.x + offset.x;
          const top = startRect.top + dragDeltaRef.current.y + offset.y;
          prevRectsRef.current.set(groupKey, { left, top, right: left + width, bottom: top + height });
        }
      }
      setOrderKeys((prev) => {
        // A card in the dragged group may have left the hand mid-drag (e.g.
        // a play/exchange resolving through another input path while this
        // one was still held) - the render-time reconcile already dropped
        // its key from `prev` in that case. Re-inserting it here regardless
        // would resurrect a dead slot key with no matching card, which then
        // lingers in orderKeys (and gets persisted to localStorage/the
        // server) forever, since resolveVisualOrder silently skips keys it
        // can't match instead of surfacing the mismatch.
        const stillDraggedGroup = group.filter((k) => prev.includes(k));
        if (stillDraggedGroup.length === 0) return prev;
        const remaining = prev.filter((k) => !stillDraggedGroup.includes(k));
        const clamped = Math.max(0, Math.min(finalDropIndex, remaining.length));
        return [...remaining.slice(0, clamped), ...stillDraggedGroup, ...remaining.slice(clamped)];
      });
    }
    setDraggingKeys(null);
    setDropIndex(null);
    dragPointerIdRef.current = null;
    dragOriginRef.current = null;
    setDragDelta({ x: 0, y: 0 });
    dragStartRectRef.current = null;
    dragOffsetsRef.current = new Map();
    dragStartIndexRef.current = null;
    if (cancelled) justDraggedRef.current = false;
    else if (justDraggedRef.current) {
      // A pointer released outside the hand may not produce the trailing
      // click that handleClickCapture uses to clear this flag. Expire it at
      // the end of the current browser task so an actual trailing click is
      // still suppressed, while the next unrelated click is not swallowed.
      window.setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
    }
  }

  // Without pointer capture (see handleCardPointerDown), a mouse release
  // outside the panel - e.g. dragging up into the score board above the
  // hand, a perfectly natural gesture - would never fire the container's
  // own onPointerUp, leaving the drag stuck. A window-level listener
  // guarantees the drag always ends wherever the pointer actually comes up.
  useEffect(() => {
    if (draggingKeys === null) return;
    function handleWindowPointerMove(event: PointerEvent) {
      updateDragPointer(event.clientX, event.clientY, event.buttons, event.pointerId);
    }
    function handleWindowPointerUp(event: PointerEvent) {
      endDrag(false, event.pointerId);
    }
    function handleWindowPointerCancel(event: PointerEvent) {
      endDrag(true, event.pointerId);
    }
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
    // Only the active/inactive transition needs to (re)install the
    // listeners - endDrag reads dropIndexRef/dragDeltaRef (always current)
    // rather than closing over dropIndex/dragDelta, so the specific closure
    // instance attached here doesn't need to be refreshed on every update.
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
      const card = el?.querySelector<HTMLElement>('[data-testid="card"]');
      const cardBounds = card?.getBoundingClientRect();
      const bounds = cardBounds && (cardBounds.width > 0 || cardBounds.height > 0)
        ? cardBounds
        : el?.getBoundingClientRect();
      if (bounds && rectsIntersect(rect, bounds)) hits.push(entry.handIndex);
    }
    return hits;
  }

  function beginMarquee(clientX: number, clientY: number, pointerId: number) {
    if (!containerRef.current) return;
    if (dragPointerIdRef.current !== null || marqueePointerIdRef.current !== null) return;
    marqueePointerIdRef.current = pointerId;
    const containerRect = containerRef.current.getBoundingClientRect();
    const start: Point = { x: clientX, y: clientY };
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
      // Reads the ref rather than a `visualEntries` closed over at gesture
      // start, so a hand change mid-drag (a play resolving, a server
      // update landing) is reflected immediately instead of hit-testing a
      // stale mapping.
      applySelection(computeMarqueeHits(rectFromPoints(start, cur), visualEntriesRef.current));
    }
    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      marqueePointerIdRef.current = null;
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

  function handleContainerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isTouchFirstDevice()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Only a press directly on the panel's empty space starts a marquee -
    // a press that bubbled up from a card slot (its target is deep inside
    // that slot, not this container) is a card drag/click instead, already
    // handled by handleCardPointerDown above.
    if (event.target !== event.currentTarget) return;
    beginMarquee(event.clientX, event.clientY, event.pointerId);
  }

  function handleCardKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: string,
    handIndex: number,
    visualEntries: { key: string; handIndex: number }[],
  ) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const currentIndex = visualEntries.findIndex((entry) => entry.key === key);
      const targetIndex = currentIndex + (event.key === "ArrowLeft" ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= visualEntries.length) return;
      selectKeyboardRange(key, visualEntries, visualEntries[targetIndex].key);
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (event.key === "Enter" || event.key === " ")) {
      selectKeyboardRange(key, visualEntries, key);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const group =
      selected.length > 1 && selected.includes(handIndex)
        ? visualEntries.filter((entry) => selected.includes(entry.handIndex)).map((entry) => entry.key)
        : [key];
    const keys = visualEntries.map((entry) => entry.key);
    const indices = group.map((groupKey) => keys.indexOf(groupKey));
    const minIndex = Math.min(...indices);
    const maxIndex = Math.max(...indices);
    const movingLeft = event.key === "ArrowLeft";
    const adjacentIndex = movingLeft ? minIndex - 1 : maxIndex + 1;
    if (adjacentIndex < 0 || adjacentIndex >= keys.length) return;
    const remaining = keys.filter((candidate) => !group.includes(candidate));
    const adjacentKey = keys[adjacentIndex];
    const insertionIndex = movingLeft
      ? remaining.indexOf(adjacentKey)
      : remaining.indexOf(adjacentKey) + 1;
    setOrderKeys([
      ...remaining.slice(0, insertionIndex),
      ...group,
      ...remaining.slice(insertionIndex),
    ]);
    event.preventDefault();
  }

  useImperativeHandle(ref, () => ({
    startMarqueeFrom: (event) => beginMarquee(event.clientX, event.clientY, event.pointerId),
  }));

  // draggingKeys/dropIndex are both seeded on every card press (see
  // handleCardPointerDown) and cleared on every release (see endDrag), even
  // a plain click that never becomes a drag - so neither is a safe FLIP
  // dependency on its own, it'd re-measure (and, since a selected card's own
  // "lifted" styling genuinely shifts its rect, sometimes re-animate) the
  // whole hand on every click. This only changes once a press has actually
  // crossed the drag-activation threshold, and only to the hover-driven
  // dropIndex from then on - exactly mirroring isActivelyDragging/
  // displayItems below, which is what actually determines the rendered
  // layout the effect needs to react to.
  const isActivelyDragging =
    draggingKeys !== null && Math.hypot(dragDelta.x, dragDelta.y) > DRAG_ACTIVATION_THRESHOLD_PX;
  const dragReflowKey = isActivelyDragging ? dropIndex : null;

  // FLIP reflow for every reorder (drag-triggered or a hand-shape change
  // filling a gap): compares each slot's position just before this render
  // to where it landed just after, and if it moved, animates from the old
  // position to the new one instead of letting it pop.
  // Also keyed on dragReflowKey, not just orderKeys - the "make room" gap
  // reflows the other cards' DOM positions on every hover-target change
  // during a live drag, well before orderKeys itself ever changes. Without
  // that in the deps, prevRectsRef only ever got refreshed by committed
  // reorders, so it went stale for the whole drag; the eventual orderKeys
  // commit at drop would then compare against that stale, pre-drag baseline
  // and yank every already-settled card back to where it was before the
  // drag started, then slide it forward again - a single large, spurious
  // animation across most of the hand for what was really just one card
  // moving. Including it here keeps the baseline current throughout the
  // gesture, so the drop only animates whatever actually changed since the
  // last hover step, and the live gap now slides smoothly too instead of
  // popping between hover targets.
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    slotRefs.current.forEach((el, key) => {
      const prev = prevRects.get(key);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (!dx && !dy) return;
      if (prefersReducedMotion) return;
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
    slotRefs.current.forEach((el, key) => nextRects.set(key, el.getBoundingClientRect()));
    prevRectsRef.current = nextRects;
  }, [orderKeys, dragReflowKey, prefersReducedMotion]);

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

  // isActivelyDragging computed above (see dragReflowKey) - only once a
  // press has actually crossed the drag threshold does a card leave its
  // normal grid slot for the floating overlay - a stationary press (an
  // ordinary click) never touches this, so it never risks a native
  // pointerup/click resolving to the wrong element (see
  // DRAG_ACTIVATION_THRESHOLD_PX above).

  type DisplayItem =
    | { type: "card"; key: string; handIndex: number }
    | { type: "placeholder"; key: string; isVisible: boolean };

  let displayItems: DisplayItem[];
  if (isActivelyDragging && draggingKeys) {
    const remaining = visualEntries.filter((entry) => !draggingKeys.includes(entry.key));
    const clampedDropIndex = Math.max(0, Math.min(dropIndex ?? remaining.length, remaining.length));
    const asCards = remaining.map((entry) => ({ type: "card" as const, key: entry.key, handIndex: entry.handIndex }));
    // The dragged group is rendered as a fixed overlay, so it would otherwise
    // leave only one in-flow placeholder behind and shorten a wrapped hand
    // whenever more than one card was selected. Keep one visible insertion
    // gap and enough invisible same-sized spacers to retain every slot.
    const draggedSlotCount = draggingKeys.filter((key) =>
      visualEntries.some((entry) => entry.key === key),
    ).length;
    const placeholders = Array.from({ length: draggedSlotCount }, (_, index) => ({
      type: "placeholder" as const,
      key: `__drop-placeholder__${index}`,
      isVisible: index === 0,
    }));
    displayItems = [
      ...asCards.slice(0, clampedDropIndex),
      ...placeholders,
      ...asCards.slice(clampedDropIndex),
    ];
  } else {
    displayItems = visualEntries.map((entry) => ({ type: "card" as const, key: entry.key, handIndex: entry.handIndex }));
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
      ref={containerRef}
      data-testid="player-hand"
      aria-label="Your hand"
      aria-describedby="player-hand-instructions"
      // w-full (not shrink-wrapped to the cards) so there's real empty
      // panel space to start a marquee drag from - this sits inside a
      // `flex-col items-start` parent (app/game/[id]/page.tsx), which
      // shrink-wraps auto-width flex children to their content, leaving
      // next to no background to click without this.
      className="relative flex w-full flex-wrap gap-1"
      onClickCapture={handleClickCapture}
      onPointerDown={handleContainerPointerDown}
      onPointerUp={(event) => endDrag(false, event.pointerId)}
      onPointerCancel={(event) => endDrag(true, event.pointerId)}
    >
      {displayItems.map((item) => {
        if (item.type === "placeholder") {
          return (
            <div
              key={item.key}
              aria-hidden="true"
              data-testid={item.isVisible ? "drop-placeholder" : "drop-placeholder-spacer"}
              className={item.isVisible
                ? "h-20 w-14 rounded-xl border-2 border-dashed border-blue-300 sm:h-24 sm:w-16"
                : "pointer-events-none h-20 w-14 opacity-0 sm:h-24 sm:w-16"}
            />
          );
        }
        const { key, handIndex } = item;
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) slotRefs.current.set(key, el);
              else slotRefs.current.delete(key);
            }}
            data-testid="hand-card-slot"
            data-key={key}
            style={{ touchAction: "none", userSelect: "none" }}
            className={prefersReducedMotion ? undefined : "transition-[transform,box-shadow] duration-200 ease-out"}
            onPointerDown={(event) => handleCardPointerDown(event, key, handIndex, visualEntries)}
          >
              <Card
                card={hand[handIndex]}
                selected={selected.includes(handIndex)}
                onClick={(event) => handleCardClick(event, handIndex, key, visualEntries)}
                onKeyDown={(event) => handleCardKeyDown(event, key, handIndex, visualEntries)}
              />
          </div>
        );
      })}
      {isActivelyDragging &&
        draggingKeys &&
        dragStartRectRef.current &&
        draggingKeys.map((key) => {
          const entry = visualEntries.find((candidate) => candidate.key === key);
          if (!entry) return null;
          const offset = dragOffsetsRef.current.get(key) ?? { x: 0, y: 0 };
          const startRect = dragStartRectRef.current!;
          return (
            <div
              key={key}
              aria-hidden="true"
              data-testid="dragging-card"
              style={{
                position: "fixed",
                left: startRect.left + dragDelta.x + offset.x,
                top: startRect.top + dragDelta.y + offset.y,
                zIndex: 50,
                pointerEvents: "none",
                transform: prefersReducedMotion ? undefined : "scale(1.06)",
              }}
              className="shadow-xl"
            >
              <Card card={hand[entry.handIndex]} selected={selected.includes(entry.handIndex)} />
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
      <span id="player-hand-instructions" className="sr-only">
        Click a card to select it. Shift-click, Shift+Enter, or Shift+Arrow selects a range. Use the
        left and right arrow keys to reorder the focused card or selected group. Drag from empty
        space to select cards with a box, or drag selected cards to move them together.
      </span>
      <span aria-live="polite" className="sr-only">
        {selected.length} card{selected.length === 1 ? "" : "s"} selected
        {marquee ? "; selecting with box" : ""}
      </span>
    </div>
  );
});

export default PlayerHand;
