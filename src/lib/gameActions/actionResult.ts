// Shared return shape for src/lib/gameActions/* functions: the plain-data
// equivalent of a route's `NextResponse.json(body, {status})`, so the same
// function can be called by an HTTP route (which turns this into a
// NextResponse) or in-process by the bot runner (which just reads `body`).
export interface ActionResult<TBody> {
  status: number;
  body: TBody;
}
