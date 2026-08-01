// POST /api/game/[id]/exchange-cards — see RULES.md "Card Exchange (After
// Each Round)". Thin HTTP wrapper: the actual logic lives in
// lib/gameActions/exchangeCards.ts so the bot runner (Phase 7) can call the
// exact same code in-process.
import { NextResponse } from "next/server";
import { exchangeCards } from "@/lib/gameActions/exchangeCards";
import { parseJsonBody } from "@/lib/http";
import type { ExchangeCardsRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ExchangeCardsRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, cardToGive } = parsed.body;
  if (!playerId || !cardToGive) {
    return NextResponse.json(
      { error: "playerId and cardToGive are required" },
      { status: 400 },
    );
  }

  const result = await exchangeCards(gameId, playerId, cardToGive);
  return NextResponse.json(result.body, { status: result.status });
}
