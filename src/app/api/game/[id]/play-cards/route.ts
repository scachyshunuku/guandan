// POST /api/game/[id]/play-cards — see ARCHITECTURE.md section 7 ("Play
// Combination") and IMPLEMENTATION.md Task 3.2. Thin HTTP wrapper: the
// actual logic lives in lib/gameActions/playCards.ts so the bot runner
// (Phase 7) can call the exact same code in-process.
import { NextResponse } from "next/server";
import { playCards } from "@/lib/gameActions/playCards";
import { parseJsonBody } from "@/lib/http";
import type { PlayCardsRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<PlayCardsRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { cards, playerId } = parsed.body;
  if (!cards || !playerId) {
    return NextResponse.json(
      { error: "cards and playerId are required" },
      { status: 400 },
    );
  }

  const result = await playCards(gameId, playerId, cards);
  return NextResponse.json(result.body, { status: result.status });
}
