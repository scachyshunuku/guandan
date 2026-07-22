"use client";

import { canPlayCards } from "@/lib/gameRules/validation";
import type { CardWithWild, CurrentTrick, StandardRank } from "@/lib/types";

export interface ActionButtonsProps {
  hand: CardWithWild[];
  selectedCards: CardWithWild[];
  currentTrick: CurrentTrick;
  levelRank: StandardRank;
  isMyTurn: boolean;
  onPlay: (cards: CardWithWild[]) => void;
  onPass: () => void;
  isSubmitting?: boolean;
}

// Play/Pass controls for the viewer's turn. Play re-runs the same
// canPlayCards check the server enforces (lib/gameRules/validation.ts) so the
// button is disabled before a doomed request round-trips, not just after it
// fails. Passing is only legal when responding to a lead (RULES.md "When
// Leading": the leader must play), so it stays disabled on an empty trick.
export default function ActionButtons({
  hand,
  selectedCards,
  currentTrick,
  levelRank,
  isMyTurn,
  onPlay,
  onPass,
  isSubmitting = false,
}: ActionButtonsProps) {
  const playValidation = canPlayCards(selectedCards, hand, currentTrick, levelRank);
  const canPlay = isMyTurn && !isSubmitting && playValidation.valid;
  const canPass = isMyTurn && !isSubmitting && currentTrick.length > 0;

  return (
    <div data-testid="action-buttons" className="flex items-center gap-3">
      <button
        type="button"
        data-testid="play-button"
        disabled={!canPlay}
        onClick={() => onPlay(selectedCards)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        Play
      </button>
      <button
        type="button"
        data-testid="pass-button"
        disabled={!canPass}
        onClick={onPass}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:text-gray-300"
      >
        Pass
      </button>
      {isMyTurn && selectedCards.length > 0 && !playValidation.valid && (
        <span data-testid="play-invalid-reason" className="text-xs text-red-500">
          {playValidation.reason}
        </span>
      )}
    </div>
  );
}
