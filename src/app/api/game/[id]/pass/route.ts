// POST /api/game/[id]/pass — see ARCHITECTURE.md section 7 ("Pass") and
// IMPLEMENTATION.md Task 3.2. Thin HTTP wrapper: the actual logic lives in
// lib/gameActions/pass.ts so the bot runner (Phase 7) can call the exact
// same code in-process.
import { NextResponse } from "next/server";
import { pass } from "@/lib/gameActions/pass";
import { parseJsonBody } from "@/lib/http";
import type { PassRequest } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<PassRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json(
      { error: "playerId is required" },
      { status: 400 },
    );
  }

  const result = await pass(gameId, playerId);
  return NextResponse.json(result.body, { status: result.status });
}
