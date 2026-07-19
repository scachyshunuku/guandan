import { NextRequest, NextResponse } from "next/server";
import { unwrapSupabaseResult, withApiErrorHandling } from "./errorHandling";

describe("withApiErrorHandling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes through a handler's successful response unchanged", async () => {
    const handler = withApiErrorHandling(async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );

    const response = await handler(new NextRequest("http://localhost/api/game/game-1"), {
      params: Promise.resolve({ id: "game-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns a generic 500 and logs the real error when the handler throws", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("column \"foo\" does not exist");

    const handler = withApiErrorHandling(async () => {
      throw thrown;
    });

    const response = await handler(new NextRequest("http://localhost/api/game/game-1?playerId=x"), {
      params: Promise.resolve({ id: "game-1" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("does not exist");

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [, context] = consoleError.mock.calls[0];
    expect(context).toMatchObject({
      method: "GET",
      url: "http://localhost/api/game/game-1?playerId=x",
      error: thrown,
    });
  });
});

describe("unwrapSupabaseResult", () => {
  it("returns data when there's no error", () => {
    expect(unwrapSupabaseResult({ data: { id: "1" }, error: null })).toEqual({ id: "1" });
  });

  it("throws the Postgrest error so withApiErrorHandling can catch it", () => {
    const error = { name: "PostgrestError", message: "boom", details: "", hint: "", code: "" };

    expect(() => unwrapSupabaseResult({ data: null, error: error as never })).toThrow("boom");
  });
});
