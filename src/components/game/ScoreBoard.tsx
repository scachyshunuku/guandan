"use client";

import { STANDARD_RANK_ORDER } from "@/lib/cardUtils";
import type { Game, StandardRank, Team } from "@/lib/types";

const LEVEL_LABELS: Record<StandardRank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  JACK: "J",
  QUEEN: "Q",
  KING: "K",
  ACE: "A",
};

// Level -> short label, e.g. 5 -> "5", 11 -> "J", 14 -> "A" (levels run 2-14,
// 14 = Ace, per types.ts and RULES.md "Levels").
const LEVEL_TO_LABEL = new Map<number, string>(
  STANDARD_RANK_ORDER.map((rank, i) => [i + 2, LEVEL_LABELS[rank]]),
);

export interface ScoreBoardProps {
  game: Pick<Game, "teamALevel" | "teamBLevel" | "winningTeam">;
}

const TEAMS: readonly { team: Team; label: string; levelKey: "teamALevel" | "teamBLevel" }[] = [
  { team: 0, label: "Team A", levelKey: "teamALevel" },
  { team: 1, label: "Team B", levelKey: "teamBLevel" },
];

// Team level & progress display. There's no separate points score in
// Guandan (RULES.md "Scoring") — level promotions *are* the score, so each
// team's level doubles as both.
export default function ScoreBoard({ game }: ScoreBoardProps) {
  return (
    <div data-testid="score-board" className="flex flex-col gap-3">
      {TEAMS.map(({ team, label, levelKey }) => {
        const level = game[levelKey];
        const isWinner = game.winningTeam === team;

        return (
          <div key={team} data-testid={`score-board-team-${team}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span>{label}</span>
              <span data-testid="score-board-level">
                Level {LEVEL_TO_LABEL.get(level) ?? level}
              </span>
              {isWinner && (
                <span data-testid="score-board-winner" className="text-xs font-semibold text-emerald-600">
                  Winner
                </span>
              )}
            </div>
            <div data-testid="score-board-progress" className="flex gap-0.5">
              {STANDARD_RANK_ORDER.map((rank, i) => {
                const rankLevel = i + 2;
                return (
                  <span
                    key={rank}
                    data-testid="score-board-progress-segment"
                    data-filled={rankLevel <= level}
                    className={`h-2 flex-1 rounded-sm ${
                      rankLevel <= level ? "bg-blue-500" : "bg-gray-200"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
