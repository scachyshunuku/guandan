// POST /api/game/[id]/drive-bots — IMPLEMENTATION.md Phase 8 (mixed
// human+bot play). Performs at most one bot action if the game's current
// state calls for one, otherwise no-ops. Called on an interval by any
// connected seated client (see useGame.ts's drive-bots effect) so bot turns
// happen automatically as the game progresses, paced by the polling
// interval rather than all resolved instantly. No request body: unlike the
// six decision routes, nothing here depends on which human is asking —
// every dispatched action already carries its own bot's server-controlled
// identity (lib/bot/botRunner.ts), so there's no caller identity to gate on.
import { NextResponse } from "next/server";
import { getGame, getParticipants } from "@/lib/gameDb";
import { driveOneBotAction, type BotSeat } from "@/lib/bot/botRunner";
import type { DriveBotsResponse } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const participants = await getParticipants(gameId);
  const bots: BotSeat[] = participants
    .filter((p) => p.is_bot && p.position !== null)
    .map((p) => ({ position: p.position!, playerId: p.player_id }));

  const step = await driveOneBotAction(gameId, bots);
  if (step.kind === "error") {
    console.error("drive-bots: bot action failed", step.reason);
    return NextResponse.json({ error: step.reason }, { status: 500 });
  }

  const response: DriveBotsResponse = { acted: step.kind === "acted" };
  return NextResponse.json(response);
}
