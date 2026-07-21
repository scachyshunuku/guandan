/**
 * @jest-environment node
 */
// http.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import { isValidUuid } from "./http";

describe("isValidUuid", () => {
  it.each([
    "d4bd299a-9d99-4d1e-be4a-70dd421004dc",
    "00000000-0000-0000-0000-000000000000",
    "D4BD299A-9D99-4D1E-BE4A-70DD421004DC",
  ])("accepts %s", (value) => {
    expect(isValidUuid(value)).toBe(true);
  });

  it.each([
    "does-not-exist",
    "",
    "d4bd299a-9d99-4d1e-be4a-70dd421004dc-extra",
    "d4bd299a-9d99-4d1e-be4a-70dd421004d", // one hex digit short
    "not-a-uuid-at-all",
    "'; drop table games; --",
  ])("rejects %s", (value) => {
    expect(isValidUuid(value)).toBe(false);
  });
});
