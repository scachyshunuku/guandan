// Shared disconnect/reconnect presence threshold. See ARCHITECTURE.md
// "Disconnect & Reconnect": "Client stops sending heartbeats -> server marks
// is_connected = false after 5 minutes." Used both to derive a participant's
// live connected status at read time (gameStateResponse.ts - self-healing
// even if no heartbeat has swept the DB recently) and by the heartbeat
// route's own sweep of every *other* participant's stored `is_connected`.
export const HEARTBEAT_STALE_MS = 5 * 60_000;

export function isHeartbeatRecent(lastHeartbeat: string, now: number = Date.now()): boolean {
  return now - new Date(lastHeartbeat).getTime() < HEARTBEAT_STALE_MS;
}
