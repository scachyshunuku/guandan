// Small helpers shared by API routes under src/app/api.
import { NextResponse } from "next/server";

// Every game's shareable "code" is its `games.id` UUID (ARCHITECTURE.md
// section 2 — no separate code column), and route handlers pass the `[id]`
// route param straight into `.eq("id", ...)`/`.eq("game_id", ...)` filters
// against uuid-typed columns. Postgres rejects a non-UUID-shaped value there
// with error 22P02 ("invalid input syntax for type uuid"), which propagates
// as an unhandled exception — a raw 500 — instead of the "no such game" 404
// a malformed id should produce. Checking the shape up front lets every
// route treat "malformed" the same as "well-formed but nonexistent," without
// a round trip to the database.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type ParsedBody<T> =
  | { body: T; errorResponse?: undefined }
  | { body?: undefined; errorResponse: NextResponse };

// Parses a request body as JSON, returning a ready-to-return 400 response on
// failure so route handlers don't each repeat the same try/catch.
export async function parseJsonBody<T>(request: Request): Promise<ParsedBody<T>> {
  try {
    return { body: (await request.json()) as T };
  } catch {
    return {
      errorResponse: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
}
