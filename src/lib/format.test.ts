import { gameShareLink, nameForPosition, pluralize } from "./format";
import type { GameParticipant } from "./types";

describe("pluralize", () => {
  it("uses the singular form for a count of 1", () => {
    expect(pluralize(1, "card")).toBe("1 card");
  });

  it("uses the default plural form (appending 's') otherwise", () => {
    expect(pluralize(0, "card")).toBe("0 cards");
    expect(pluralize(2, "card")).toBe("2 cards");
  });

  it("supports an irregular plural form", () => {
    expect(pluralize(1, "die", "dice")).toBe("1 die");
    expect(pluralize(2, "die", "dice")).toBe("2 dice");
  });
});

describe("gameShareLink", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("builds an absolute link using the current origin when NEXT_PUBLIC_APP_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(gameShareLink("game-123")).toBe(`${window.location.origin}/game/game-123`);
  });

  it("prefers NEXT_PUBLIC_APP_URL over the current origin when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://guandan.example.com";
    expect(gameShareLink("game-123")).toBe("https://guandan.example.com/game/game-123");
  });

  it("strips a trailing slash from NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://guandan.example.com/";
    expect(gameShareLink("game-123")).toBe("https://guandan.example.com/game/game-123");
  });
});

function participant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    handCount: overrides.hand?.length ?? 0,
    handOrder: overrides.handOrder ?? null,
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    isBot: false,
    ...overrides,
  };
}

describe("nameForPosition", () => {
  const participants = [
    participant({ id: "p0", playerName: "Alice", position: 0 }),
    participant({ id: "p1", playerName: "Bob", position: 1 }),
  ];

  it("resolves a seated position to that player's name", () => {
    expect(nameForPosition(1, participants)).toBe("Bob");
  });

  it("falls back to a position label when no participant occupies that seat", () => {
    expect(nameForPosition(3, participants)).toBe("Position 3");
  });
});
