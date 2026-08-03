// Small shared display-formatting helpers used across game/ components.
import type { GameParticipant, Team } from "./types";

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

// RULES.md refers to finishing ranks as "1st/2nd/3rd/4th place" throughout;
// mirrors that wording instead of a bare rank number.
const ORDINAL_PLACES = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" } as const;

export function ordinalPlace(place: 1 | 2 | 3 | 4): string {
  return `${ORDINAL_PLACES[place]} place`;
}

// Team A = positions 0 & 2, Team B = positions 1 & 3 (RULES.md "Players &
// Teams"; also lib/gameRules/scoring.ts's positionTeam, kept separate since
// that one's server-side game logic and this is a purely cosmetic UI
// mapping). Team A is colored blue, Team B orange, wherever a player's name
// is shown alongside their team (ScoreBoard, GameHistory).
const TEAM_TEXT_CLASS: Record<Team, string> = {
  0: "text-blue-600",
  1: "text-orange-600",
};

export function teamForPosition(position: number): Team {
  return (position % 2) as Team;
}

export function teamTextClass(team: Team): string {
  return TEAM_TEXT_CLASS[team];
}

// The shareable join link for a game (Game.id doubles as the code - see
// gameStore.ts's doc comment). Prefers NEXT_PUBLIC_APP_URL so the link is
// stable behind proxies/custom domains; falls back to window.location.origin
// when it's unset, then to a relative path when there's no `window` either
// (server-rendered markup, before the client swaps in the full origin) -
// shared by CreateGameForm.tsx and game/[id]/page.tsx's WaitingRoom so both
// display the exact same link.
export function gameShareLink(gameId: string): string {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const baseUrl = configuredBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${baseUrl}/game/${gameId}`;
}
