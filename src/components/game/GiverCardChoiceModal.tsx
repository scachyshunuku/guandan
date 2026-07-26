"use client";

import type { Card } from "@/lib/types";
import CardComponent from "./Card";

export interface GiverCardChoiceModalProps {
  // Every card in the viewer's own hand tied for their "best card"
  // contribution — computed client-side (lib/gameRules/cardExchange.ts's
  // bestCardCandidates) from their own private hand, since only they can
  // see it; the server independently re-validates whichever one they pick.
  candidates: Card[];
  onChoose: (card: Card) => void;
  isSubmitting?: boolean;
}

// Shown when the viewer's own hand has multiple cards tied for their "best
// card" contribution to the initial tribute exchange (RULES.md "Card
// Exchange" -> "Best card, when tied": "if the player giving their best
// card... holds more than one card tied for that best rank, they choose
// which one to give") — mirrors 1st place's TributeChoiceModal, but for the
// giver's own side of the exchange instead of the recipient's.
export default function GiverCardChoiceModal({
  candidates,
  onChoose,
  isSubmitting = false,
}: GiverCardChoiceModalProps) {
  return (
    <div
      data-testid="giver-card-choice-modal"
      className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
    >
      <h2 className="text-sm font-semibold text-gray-900">Choose Your Best Card</h2>
      <p data-testid="giver-card-choice-prompt" className="text-sm text-gray-700">
        You have more than one card tied for your best card — choose which one to give (you
        keep the rest).
      </p>
      <div data-testid="giver-card-choice-options" className="flex flex-wrap gap-2">
        {candidates.map((card, index) => (
          <CardComponent
            key={index}
            card={card}
            onClick={isSubmitting ? undefined : () => onChoose(card)}
          />
        ))}
      </div>
    </div>
  );
}
