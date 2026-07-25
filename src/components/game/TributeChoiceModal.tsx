"use client";

import type { Card, PlayerPosition } from "@/lib/types";
import CardComponent from "./Card";

export interface TributeChoiceModalProps {
  thirdPosition: PlayerPosition;
  thirdCard: Card;
  fourthPosition: PlayerPosition;
  fourthCard: Card;
  // Only 1st place actually chooses (RULES.md "Two-Team Lead"); everyone
  // else just watches and waits, same as CardExchangeModal's "no return
  // needed" branch.
  isFirstPlace: boolean;
  onChoose: (take: PlayerPosition) => void;
  isSubmitting?: boolean;
}

// Shown when a round's initial tribute exchange found 3rd and 4th place's
// best cards tied in rank (RULES.md "Two-Team Lead": "If the two cards are
// the same rank, 1st place chooses which card to take (then 2nd place gets
// the other)") — end-hand/route.ts pauses the round on
// 'awaiting_tribute_choice' for exactly this decision rather than resolving
// the tie arbitrarily.
export default function TributeChoiceModal({
  thirdPosition,
  thirdCard,
  fourthPosition,
  fourthCard,
  isFirstPlace,
  onChoose,
  isSubmitting = false,
}: TributeChoiceModalProps) {
  return (
    <div
      data-testid="tribute-choice-modal"
      className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
    >
      <h2 className="text-sm font-semibold text-gray-900">Tribute Cards Tied</h2>

      {isFirstPlace ? (
        <>
          <p data-testid="tribute-choice-prompt" className="text-sm text-gray-700">
            Position {thirdPosition} and position {fourthPosition} gave tied tribute cards —
            choose which one to take (the other goes to 2nd place).
          </p>
          <div className="flex gap-4">
            <div
              data-testid="tribute-choice-option"
              data-position={thirdPosition}
              className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 p-2"
            >
              <CardComponent
                card={thirdCard}
                onClick={isSubmitting ? undefined : () => onChoose(thirdPosition)}
              />
              <span className="text-xs text-gray-600">From position {thirdPosition}</span>
            </div>
            <div
              data-testid="tribute-choice-option"
              data-position={fourthPosition}
              className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 p-2"
            >
              <CardComponent
                card={fourthCard}
                onClick={isSubmitting ? undefined : () => onChoose(fourthPosition)}
              />
              <span className="text-xs text-gray-600">From position {fourthPosition}</span>
            </div>
          </div>
        </>
      ) : (
        <p data-testid="tribute-choice-waiting" className="text-sm text-gray-500">
          Position {thirdPosition} and position {fourthPosition} gave tied tribute cards —
          waiting for 1st place to choose…
        </p>
      )}
    </div>
  );
}
