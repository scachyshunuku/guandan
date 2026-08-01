// POST /api/game/[id]/choose-tribute — see RULES.md "Two-Team Lead". Thin
// HTTP wrapper: the actual logic lives in lib/gameActions/chooseTribute.ts
// so the bot runner (Phase 7) can call the exact same code in-process.
import { NextResponse } from "next/server";
import { chooseTribute } from "@/lib/gameActions/chooseTribute";
import { isPlayerPosition } from "@/lib/gameDb";
import { parseJsonBody } from "@/lib/http";
import type { ChooseTributeRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ChooseTributeRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, take } = parsed.body;
  if (!playerId || !isPlayerPosition(take)) {
    return NextResponse.json(
      { error: "playerId and a valid take are required" },
      { status: 400 },
    );
  }

  const result = await chooseTribute(gameId, playerId, take);
  return NextResponse.json(result.body, { status: result.status });
}
