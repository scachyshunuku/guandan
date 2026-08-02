import type { GameParticipant } from "@/lib/types";
import { nameForPosition, ordinalPlace } from "@/lib/format";
import TeamName from "./TeamName";

export interface RoundEndSummaryProps {
  // GameRound.finishingPositions — indexed by seat position, value is that
  // seat's finishing place (1-4). RULES.md "Round End": the 4th-place slot
  // here can be a player who never actually played out their last card
  // (auto-placed once the other three have finished, or assigned outright
  // on a 1-2 finish) - unlike GameHistory's per-play "player_finished" log
  // entries, this always has all four places filled in.
  finishingPositions: number[];
  participants: GameParticipant[];
}

const PLACES = [1, 2, 3, 4] as const;

export default function RoundEndSummary({ finishingPositions, participants }: RoundEndSummaryProps) {
  return (
    <div
      data-testid="round-end-summary"
      className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
    >
      <h2 className="text-sm font-semibold text-gray-900">Round complete</h2>
      <ol className="flex flex-col gap-1 text-sm text-gray-700">
        {PLACES.map((place) => {
          const position = finishingPositions.indexOf(place);
          return (
            <li key={place} data-testid="round-end-place" data-place={place}>
              {ordinalPlace(place)} —{" "}
              <TeamName name={nameForPosition(position, participants)} position={position} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
