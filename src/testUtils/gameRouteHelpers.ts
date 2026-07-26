// Shared request-building helpers for integration tests that drive the
// game API route handlers directly (rather than over HTTP) against the
// fake Supabase client — used by both fullGameSetup.integration.test.ts and
// fullGameFlow.integration.test.ts. Callers must still put their own
// `jest.mock("@/lib/supabaseAdmin")` / `jest.mock("@/lib/realtimeBroadcast")`
// in their own test file (jest.mock is hoisted per-file, and each test file
// needs its own fake instance from `supabaseAdmin as unknown as
// FakeSupabaseClient`), but the request/response plumbing itself doesn't
// need repeating per file.
import { POST as createGame } from "@/app/api/game/create/route";
import { POST as joinGame } from "@/app/api/game/[id]/join/route";
import { POST as startGame } from "@/app/api/game/[id]/start/route";

export function create() {
  return createGame();
}

export function join(gameId: string, playerName: string, playerId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/join`, {
    method: "POST",
    body: JSON.stringify({ playerName, playerId }),
  });
  return joinGame(request, { params: Promise.resolve({ id: gameId }) });
}

export function start(gameId: string, playerId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
  return startGame(request, { params: Promise.resolve({ id: gameId }) });
}
