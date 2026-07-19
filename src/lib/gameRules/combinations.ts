// Combination shape identification & ranking. See RULES.md "Valid Plays" for
// the 7 ordinary combo types and the 9 bomb types.
//
// This module works on resolved `Card[]`, not `CardWithWild[]` — a played
// wild heart already stands in for a specific card by the time it gets here.
// Deciding what a wild card impersonates (and whether that's legal) is a
// play-validation concern handled in lib/gameRules/validation.ts, not here,
// matching the same split cardUtils.ts uses for card ranking.
//
// Both combo *shape* (is this a straight/tube/plate?) and, for those same
// multi-rank combos, *strength* are judged by literal rank order (RULES.md
// "natural order"), ignoring level-rank elevation: elevation is a single
// card's identity, not a whole run's, so a run that happens to pass through
// the level rank shouldn't out-rank a higher-topping run. Single/pair/triple/
// bomb/full-house strength, by contrast, *is* that one elevated rank, so
// those reuse cardUtils' getCardRank for consistency with the rest of the
// codebase.

import type { BombComboType, Card, ComboType, Rank, StandardRank } from "../types";
import { STANDARD_RANK_ORDER, getCardRank, isStandardRank } from "../cardUtils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function allSameRank(cards: Card[]): boolean {
  return cards.length > 0 && cards.every((c) => c.rank === cards[0].rank);
}

function groupByRank(cards: Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of cards) {
    const group = groups.get(card.rank);
    if (group) {
      group.push(card);
    } else {
      groups.set(card.rank, [card]);
    }
  }
  return groups;
}

// True if `sortedIndices` (already unique) form one unbroken ascending run.
function isConsecutiveRun(sortedIndices: number[]): boolean {
  for (let i = 1; i < sortedIndices.length; i++) {
    if (sortedIndices[i] !== sortedIndices[i - 1] + 1) return false;
  }
  return true;
}

// One below "2" (STANDARD_RANK_ORDER index 0) — lets Ace anchor a straight/
// tube/plate as the *low* card (RULES.md: "Ace can play low", A-2-3-4-5 is
// valid), without ever letting it bridge both ends of the order at once.
const ACE_LOW_INDEX = -1;

// Resolves `ranks` (assumed unique, no jokers) to per-rank indices under
// whichever ordering makes them one consecutive run: normal (Ace high, after
// KING) tried first, then Ace-low (Ace before "2") if Ace is present. Returns
// null if neither ordering is consecutive. At most one ordering can ever
// succeed — a run reaching both KING (Ace-high's neighbor) and "2" (Ace-low's
// neighbor) spans 13 ranks and can't be a single run of 5-13 unique ranks
// while also touching both ends — so there's no ambiguity to resolve, and
// this is exactly what makes K-A-2 / J-Q-K-A-2 style wraparounds invalid.
function resolveConsecutiveIndices(ranks: StandardRank[]): number[] | null {
  const aceHigh = ranks.map((r) => STANDARD_RANK_ORDER.indexOf(r));
  if (isConsecutiveRun([...aceHigh].sort((a, b) => a - b))) return aceHigh;

  if (!ranks.includes("ACE")) return null;
  const aceLow = ranks.map((r) => (r === "ACE" ? ACE_LOW_INDEX : STANDARD_RANK_ORDER.indexOf(r)));
  return isConsecutiveRun([...aceLow].sort((a, b) => a - b)) ? aceLow : null;
}

// Shared shape check for tubes (groupCount=3, groupSize=2) and plates
// (groupCount=2, groupSize=3): exactly `groupCount` consecutive standard
// ranks, each appearing exactly `groupSize` times.
function isConsecutiveGroupsOfN(cards: Card[], groupCount: number, groupSize: number): boolean {
  if (cards.length !== groupCount * groupSize) return false;
  const groups = groupByRank(cards);
  if (groups.size !== groupCount) return false;
  if ([...groups.values()].some((g) => g.length !== groupSize)) return false;

  const ranks = [...groups.keys()];
  if (!ranks.every(isStandardRank)) return false;
  return resolveConsecutiveIndices(ranks as StandardRank[]) !== null;
}

// ---------------------------------------------------------------------------
// Ordinary combinations (RULES.md "Ordinary Combinations (7 types)")
// ---------------------------------------------------------------------------

export function isValidSingle(cards: Card[]): boolean {
  return cards.length === 1;
}

export function isValidPair(cards: Card[]): boolean {
  return cards.length === 2 && allSameRank(cards);
}

export function isValidTriple(cards: Card[]): boolean {
  return cards.length === 3 && allSameRank(cards);
}

export function isValidFullHouse(cards: Card[]): boolean {
  if (cards.length !== 5) return false;
  const groupSizes = [...groupByRank(cards).values()].map((g) => g.length).sort();
  return groupSizes.length === 2 && groupSizes[0] === 2 && groupSizes[1] === 3;
}

// Five or more consecutive, distinct, standard ranks (no jokers), any suits.
// Ace may anchor the run as either its highest or lowest card (RULES.md
// "Ace can play low"), but never both — see resolveConsecutiveIndices.
export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  if (!cards.every((c) => isStandardRank(c.rank))) return false;

  const ranks = cards.map((c) => c.rank as StandardRank);
  if (new Set(ranks).size !== ranks.length) return false; // one card per rank

  return resolveConsecutiveIndices(ranks) !== null;
}

// Three consecutive pairs, e.g. 3-3-4-4-5-5.
export function isValidTube(cards: Card[]): boolean {
  return isConsecutiveGroupsOfN(cards, 3, 2);
}

// Two consecutive triples, e.g. 3-3-3-4-4-4.
export function isValidPlate(cards: Card[]): boolean {
  return isConsecutiveGroupsOfN(cards, 2, 3);
}

// ---------------------------------------------------------------------------
// Bombs (RULES.md "Bombs (9 types)")
// ---------------------------------------------------------------------------

// Ordered lowest to highest, mirroring BombComboType in types.ts.
export const BOMB_TYPE_ORDER: readonly BombComboType[] = Object.freeze([
  "bomb_4",
  "bomb_5",
  "straight_flush",
  "bomb_6",
  "bomb_7",
  "bomb_8",
  "bomb_9",
  "bomb_10",
  "joker_bomb",
]);

const N_OF_A_KIND_TYPE: Record<number, BombComboType> = {
  4: "bomb_4",
  5: "bomb_5",
  6: "bomb_6",
  7: "bomb_7",
  8: "bomb_8",
  9: "bomb_9",
  10: "bomb_10",
};

function isNOfAKind(cards: Card[], n: number): boolean {
  return cards.length === n && allSameRank(cards) && isStandardRank(cards[0].rank);
}

// All four jokers together (2 red + 2 black) — the single highest bomb.
export function isJokerBomb(cards: Card[]): boolean {
  if (cards.length !== 4) return false;
  const redJokers = cards.filter((c) => c.rank === "RED_JOKER").length;
  const blackJokers = cards.filter((c) => c.rank === "BLACK_JOKER").length;
  return redJokers === 2 && blackJokers === 2;
}

// Five or more consecutive ranks, all the same suit.
export function isStraightFlush(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  if (cards.some((c) => c.suit === undefined)) return false;
  if (!cards.every((c) => c.suit === cards[0].suit)) return false;
  return isValidStraight(cards);
}

// The bomb type these cards form, or null if they don't form any of the 9.
function identifyBombType(cards: Card[]): BombComboType | null {
  if (isJokerBomb(cards)) return "joker_bomb";
  if (isStraightFlush(cards)) return "straight_flush";
  for (const n of Object.keys(N_OF_A_KIND_TYPE)) {
    if (isNOfAKind(cards, Number(n))) return N_OF_A_KIND_TYPE[Number(n)];
  }
  return null;
}

export function isValidBomb(cards: Card[]): boolean {
  return identifyBombType(cards) !== null;
}

export function isBombComboType(type: ComboType): type is BombComboType {
  return (BOMB_TYPE_ORDER as readonly ComboType[]).includes(type);
}

// ---------------------------------------------------------------------------
// Combo identification & ranking
// ---------------------------------------------------------------------------

// Identifies the exact combo type for a set of cards, or null if the cards
// don't form any valid combination. Bombs are checked first since a shape
// that satisfies a bomb (e.g. 4 of a kind) never also satisfies an ordinary
// type of the same length.
export function getComboType(cards: Card[]): ComboType | null {
  if (cards.length === 0) return null;

  const bombType = identifyBombType(cards);
  if (bombType !== null) return bombType;

  if (isValidSingle(cards)) return "single";
  if (isValidPair(cards)) return "pair";
  if (isValidTriple(cards)) return "triple";
  if (isValidFullHouse(cards)) return "full_house";
  if (isValidTube(cards)) return "tube";
  if (isValidPlate(cards)) return "plate";
  if (isValidStraight(cards)) return "straight";

  return null;
}

// Highest rank index across a straight/tube/plate, resolved under whichever
// ordering (Ace-high or Ace-low) made it a valid run — so an Ace-low run's
// "top" is its highest non-Ace member, e.g. A-2-3-4-5 tops at "5", not Ace.
// Deliberately *not* level-elevated (see file header): the run's strength is
// about which ranks it spans, not whether one member happens to be the level
// card. `cards` is assumed already valid (getComboType confirmed it), so
// resolveConsecutiveIndices can't return null here.
function highestRunRankIndex(cards: Card[]): number {
  const ranks = [...new Set(cards.map((c) => c.rank as StandardRank))];
  return Math.max(...resolveConsecutiveIndices(ranks)!);
}

function comboValue(cards: Card[], type: ComboType, levelRank: StandardRank): number {
  switch (type) {
    case "joker_bomb":
      return 0; // exactly one possible joker bomb; nothing to compare against
    case "full_house": {
      const [, tripleGroup] = [...groupByRank(cards).entries()].find(([, g]) => g.length === 3)!;
      return getCardRank(tripleGroup[0], levelRank);
    }
    case "straight":
    case "straight_flush":
    case "tube":
    case "plate":
      return highestRunRankIndex(cards);
    default:
      // single, pair, triple, bomb_4..bomb_10 — every card shares one rank.
      return getCardRank(cards[0], levelRank);
  }
}

// A total-ordering strength for a combo: any bomb outranks any ordinary
// combo, bombs are further ordered by BOMB_TYPE_ORDER (RULES.md "Bombs (9
// types)"), and within a single type/tier, higher cards win. Comparable
// directly with `>`; returns null if `cards` isn't a valid combination
// (mirroring getComboType, so callers can handle client-submitted plays
// without needing a try/catch).
export function getComboRank(cards: Card[], levelRank: StandardRank): number | null {
  const type = getComboType(cards);
  if (type === null) return null;

  const value = comboValue(cards, type, levelRank);
  if (isBombComboType(type)) {
    const tier = BOMB_TYPE_ORDER.indexOf(type) + 1;
    return tier * 1000 + value;
  }
  return value;
}
