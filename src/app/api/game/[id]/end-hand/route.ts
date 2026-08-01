// POST /api/game/[id]/end-hand — see ARCHITECTURE.md section 7 ("End Hand /
// Level") and IMPLEMENTATION.md Task 3.3. Thin HTTP wrapper: the actual
// logic lives in lib/gameActions/endHand.ts so the bot runner (Phase 7) can
// call the exact same code in-process.
import { NextResponse } from "next/server";
import { endHand } from "@/lib/gameActions/endHand";
import { parseJsonBody } from "@/lib/http";
import type { EndHandRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<EndHandRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  const result = await endHand(gameId, playerId);
  return NextResponse.json(result.body, { status: result.status });
}
