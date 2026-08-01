// Seeds a fresh all-bot game (IMPLEMENTATION.md Phase 7): creates a game,
// joins 4 server-generated bot identities into it, marks them as bots, and
// starts it. Calls the existing create/join/start route handlers in-process
// with hand-built Request objects — the same pattern
// src/testUtils/gameRouteHelpers.ts already uses for tests — so seat
// assignment (firstOpenPosition) and dealing (dealHands) are never
// re-derived here.
import { randomUUID } from "crypto";
import { POST as createGame } from "@/app/api/game/create/route";
import { POST as joinGame } from "@/app/api/game/[id]/join/route";
import { POST as startGame } from "@/app/api/game/[id]/start/route";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CreateGameResponse, JoinGameResponse, PlayerPosition } from "@/lib/types";
import type { BotSeat } from "./botRunner";

const ALL_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

export async function seedBotMatch(): Promise<{ gameId: string; bots: BotSeat[] }> {
  const createResponse = await createGame();
  const { gameId } = (await createResponse.json()) as CreateGameResponse;

  const bots: BotSeat[] = [];
  for (const position of ALL_POSITIONS) {
    const playerId = randomUUID();
    const joinRequest = new Request(`http://localhost/api/game/${gameId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerName: `Bot ${position + 1}`, playerId }),
    });
    const joinResponse = await joinGame(joinRequest, { params: Promise.resolve({ id: gameId }) });
    const joined = (await joinResponse.json()) as JoinGameResponse;
    if (joined.spectator) {
      throw new Error(`seedBotMatch: expected an open seat for position ${position}, got a spectator`);
    }
    bots.push({ position: joined.position, playerId });
  }

  // Every participant of a freshly-seeded bot-match game is a bot — there
  // are no humans in it — so this can mark the whole game rather than
  // targeting individual rows. Thrown rather than logged-and-continued: a
  // silent failure here would leave a fully-played bot game indistinguishable
  // from a human one at the DB level, which defeats the point of the column.
  const { error } = await supabaseAdmin.from("game_participants").update({ is_bot: true }).eq("game_id", gameId);
  if (error) {
    throw new Error(`seedBotMatch: failed to mark participants as bots: ${JSON.stringify(error)}`);
  }

  const startRequest = new Request(`http://localhost/api/game/${gameId}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId: bots[0].playerId }),
  });
  const startResponse = await startGame(startRequest, { params: Promise.resolve({ id: gameId }) });
  if (!startResponse.ok) {
    const body = await startResponse.json();
    throw new Error(`seedBotMatch: failed to start game: ${JSON.stringify(body)}`);
  }

  return { gameId, bots };
}
