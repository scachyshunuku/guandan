import { HEARTBEAT_STALE_MS, isHeartbeatRecent } from "./presence";

describe("isHeartbeatRecent", () => {
  it("is true for a heartbeat within the stale threshold", () => {
    const now = Date.parse("2026-01-01T00:00:20Z");
    expect(isHeartbeatRecent("2026-01-01T00:00:00Z", now)).toBe(true);
  });

  it("is false once a heartbeat is exactly at the stale threshold", () => {
    const now = Date.parse("2026-01-01T00:00:00Z") + HEARTBEAT_STALE_MS;
    expect(isHeartbeatRecent("2026-01-01T00:00:00Z", now)).toBe(false);
  });

  it("is false for a heartbeat well past the stale threshold", () => {
    const now = Date.parse("2026-01-01T01:00:00Z");
    expect(isHeartbeatRecent("2026-01-01T00:00:00Z", now)).toBe(false);
  });
});
