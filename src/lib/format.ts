// Small shared display-formatting helpers used across game/ components.

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
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
