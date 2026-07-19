// Small helpers shared by API routes under src/app/api.
import { NextResponse } from "next/server";

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
