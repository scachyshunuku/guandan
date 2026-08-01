// POST /api/game/[id]/choose-giver-card — see RULES.md "Card Exchange" →
// "Best card, when tied". Thin HTTP wrapper: the actual logic lives in
// lib/gameActions/chooseGiverCard.ts so the bot runner (Phase 7) can call
// the exact same code in-process.
import { NextResponse } from "next/server";
import { chooseGiverCard } from "@/lib/gameActions/chooseGiverCard";
import { parseJsonBody } from "@/lib/http";
import type { ChooseGiverCardRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ChooseGiverCardRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, card } = parsed.body;
  if (!playerId || !card) {
    return NextResponse.json(
      { error: "playerId and card are required" },
      { status: 400 },
    );
  }

  const result = await chooseGiverCard(gameId, playerId, card);
  return NextResponse.json(result.body, { status: result.status });
}
