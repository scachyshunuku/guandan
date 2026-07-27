// Small shared display-formatting helpers used across game/ components.
import type { GameParticipant } from "./types";

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Resolves a seat position to its player's display name rather than a raw
// seat number — used anywhere game history/exchanges are shown by name
// (RULES.md "Card Exchange": "All card exchanges are visible to all
// players"). Falls back to "Position N" for an unresolvable position (there's
// no leave route yet, so today every position in an active game's history
// always resolves to a current participant).
export function nameForPosition(position: number, participants: readonly GameParticipant[]): string {
  return participants.find((p) => p.position === position)?.playerName ?? `Position ${position}`;
}

// The shareable join link for a game (Game.id doubles as the code - see
// gameStore.ts's doc comment). Falls back to a relative path when there's no
// `window` (server-rendered markup, before the client swaps in the full
// origin) - shared by CreateGameForm.tsx and game/[id]/page.tsx's
// WaitingRoom so both display the exact same link.
export function gameShareLink(gameId: string): string {
  return typeof window !== "undefined"
    ? `${window.location.origin}/game/${gameId}`
    : `/game/${gameId}`;
}
