// POST /api/game/dev/bot-match — IMPLEMENTATION.md Phase 7. Dev/test-only:
// seeds a fresh all-bot game and drives it to completion, reusing exactly
// the same server-side logic (lib/gameActions/*) a human's HTTP requests
// go through. Not linked from any UI; the created game is a normal,
// fully-persisted game, so it can still be opened at /game/[gameId] to
// watch or review it. Unauthenticated and resource-creating, so it's
// disabled outside development.
import { NextResponse } from "next/server";
import { getGame } from "@/lib/gameDb";
import { seedBotMatch } from "@/lib/bot/seedBotMatch";
import { driveBotGame } from "@/lib/bot/botRunner";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const { gameId, bots } = await seedBotMatch();
  const result = await driveBotGame(gameId, bots);
  const game = await getGame(gameId);

  return NextResponse.json({
    gameId,
    outcome: result.outcome,
    iterations: result.iterations,
    ...(result.outcome === "stalled" ? { reason: result.reason } : {}),
    finalState: game
      ? { status: game.status, teamALevel: game.team_a_level, teamBLevel: game.team_b_level }
      : null,
  });
}
