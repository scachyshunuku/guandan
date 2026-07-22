// Identifies this browser to the join API (ARCHITECTURE.md section 8:
// POST /api/game/[id]/join takes a client-supplied playerId). Persisted in
// localStorage rather than generated fresh per request so a page refresh or
// a second join attempt is recognized as the same player (see join/route.ts's
// idempotent-rejoin path, which matches on this id).
const STORAGE_KEY = "guandan:playerId";

export function getOrCreatePlayerId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
