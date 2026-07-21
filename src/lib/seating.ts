// Seat orientation relative to a viewer. Shared by GameTable and
// TrickDisplay so both agree on where each position sits on screen.

import type { PlayerPosition } from "./types";

export type SeatLabel = "north" | "south" | "east" | "west";

// Ordered so turn order matches RULES.md ("Play moves counterclockwise"):
// the viewer always sits south, their partner (always the opposite seat)
// sits north, and turn order proceeds south -> east -> north -> west -> south.
const SEAT_LABELS: readonly SeatLabel[] = ["south", "east", "north", "west"];

export function seatLabelFor(position: PlayerPosition, anchor: PlayerPosition): SeatLabel {
  const relative = (position - anchor + 4) % 4;
  return SEAT_LABELS[relative];
}
