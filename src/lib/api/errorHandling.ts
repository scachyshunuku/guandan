// Shared error handling for every /api/** route: log the full exception with
// request context server-side (visible in Vercel's function logs), but never
// leak exception detail (Postgres error text, stack traces, etc.) to the
// client — it returns a generic message instead.

import { NextRequest, NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

type RouteContext<Params extends Record<string, string> = Record<string, string>> = {
  params: Promise<Params>;
};

type RouteHandler<Params extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  context: RouteContext<Params>
) => Promise<NextResponse>;

export function withApiErrorHandling<Params extends Record<string, string> = Record<string, string>>(
  handler: RouteHandler<Params>
): RouteHandler<Params> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      // Log the full error object, not just `.message` — PostgrestError's
      // `hint`/`code`/`details` fields (see its own doc comment) usually
      // carry the actionable info, and .message alone hides it.
      console.error("Unhandled API error", {
        method: request.method,
        url: request.url,
        error,
      });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

// Every Supabase query returns { data, error } rather than throwing. This
// converts that into a throw so a single withApiErrorHandling wrapper can
// catch it, instead of every call site hand-rolling its own
// `if (error) return NextResponse.json(...)` branch.
export function unwrapSupabaseResult<T>(result: {
  data: T | null;
  error: PostgrestError | null;
}): T | null {
  if (result.error) {
    throw result.error;
  }
  return result.data;
}
