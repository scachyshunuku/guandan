// Shared client-side fetch helper for POSTing to our own /api/game routes.
// Split out of hooks/useGameActions.ts so lobby code (app/page.tsx) that
// posts to /api/game/create and /api/game/[id]/join before a useGameActions
// hook is even wireable (gameId isn't known yet) doesn't duplicate it.
export async function postJson<TResponse>(
  url: string,
  body?: unknown,
): Promise<TResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A non-2xx response isn't guaranteed to be our own JSON error shape (a
  // proxy/gateway failure can return an HTML error page), so a parse
  // failure here falls back to a generic message instead of surfacing a
  // raw "Unexpected token <" to the user. Logged since that fallback
  // message alone gives a developer nothing to debug from.
  const data = await res.json().catch((parseError) => {
    console.error(`Failed to parse response from ${url} (status ${res.status})`, parseError);
    return null;
  });
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }
  return data as TResponse;
}
