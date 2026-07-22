import { postJson } from "./httpClient";

function mockFetch(status: number, jsonImpl: () => Promise<unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jsonImpl,
  }) as jest.Mock;
}

describe("postJson", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POSTs the body as JSON and returns the parsed response on success", async () => {
    mockFetch(200, () => Promise.resolve({ ok: true }));

    const result = await postJson("/api/thing", { a: 1 });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("omits the request body when none is given", async () => {
    mockFetch(200, () => Promise.resolve({ gameId: "game-1" }));

    await postJson("/api/game/create");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/create",
      expect.objectContaining({ body: undefined }),
    );
  });

  it("throws the server's error message on a non-2xx JSON response", async () => {
    mockFetch(404, () => Promise.resolve({ error: "Game not found" }));

    await expect(postJson("/api/thing")).rejects.toThrow("Game not found");
  });

  it("falls back to a generic message and logs when the error response isn't valid JSON", async () => {
    const parseError = new SyntaxError("Unexpected token <");
    mockFetch(502, () => Promise.reject(parseError));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(postJson("/api/thing")).rejects.toThrow("Request failed");

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to parse response from /api/thing (status 502)",
      parseError,
    );
  });
});
