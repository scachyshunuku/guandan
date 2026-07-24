import { gameShareLink, pluralize } from "./format";

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
  it("builds an absolute link using the current origin", () => {
    expect(gameShareLink("game-123")).toBe(`${window.location.origin}/game/game-123`);
  });
});
