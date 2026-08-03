"use client";

// The awaiting_giver_choice branch: 4th place has multiple cards tied for
// their highest eligible tribute card and must choose which one to give before
// the card is routed to 1st or 2nd place. This uses the same selection rules
// and button state as the live game page, but stays DB-free for visual review.

import { useRef, useState } from "react";
import PlayerHand, {
  startHandPanelMarquee,
  type PlayerHandHandle,
} from "@/components/game/PlayerHand";
import { bestCardCandidates } from "@/lib/gameRules/cardExchange";
import { encodeCard } from "@/lib/cardUtils";
import { nameForPosition } from "@/lib/format";
import type { Card, PlayerPosition } from "@/lib/types";
import { mockGiverChoice, mockIdleRound, mockParticipants } from "@/mocks/gameFixtures";
import MockGameFrame from "../../_components/MockGameFrame";

export default function CardExchangeGiverChoicePreviewPage() {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [submittedCard, setSubmittedCard] = useState<Card | null>(null);
  const playerHandRef = useRef<PlayerHandHandle>(null);

  const candidates = bestCardCandidates(mockGiverChoice.hand, mockGiverChoice.levelRank);
  const selectedCard =
    selectedIndices.length === 1 ? mockGiverChoice.hand[selectedIndices[0]] : undefined;
  const canGive =
    selectedCard !== undefined &&
    candidates.some((candidate) => encodeCard(candidate) === encodeCard(selectedCard));
  const otherGiverName = nameForPosition(
    mockGiverChoice.otherGiverPosition as PlayerPosition,
    mockParticipants,
  );

  function handleGive() {
    if (!selectedCard || !canGive) return;
    setSubmittedCard(selectedCard);
    setSelectedIndices([]);
  }

  return (
    <MockGameFrame
      round={mockIdleRound}
      participants={mockParticipants}
      myPosition={mockGiverChoice.position}
      onHandPanelPointerDown={(event) => startHandPanelMarquee(event, playerHandRef)}
    >
      <PlayerHand
        ref={playerHandRef}
        hand={mockGiverChoice.hand}
        isOwnHand
        selectedIndices={selectedIndices}
        onSelectionChange={setSelectedIndices}
      />
      <div data-testid="tribute-give-controls" className="flex flex-col items-start gap-2">
        <p data-testid="tribute-give-instruction" className="text-sm text-slate-700">
          Choose one of your highest eligible cards to give as tribute. Level hearts are exempt.
        </p>
        <p className="text-xs text-slate-500">
          {otherGiverName} is also choosing; the higher card goes to 1st place and the lower card
          goes to 2nd place.
        </p>
        <button
          type="button"
          data-testid="give-tribute-button"
          disabled={!canGive}
          onClick={handleGive}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Give
        </button>
        {selectedIndices.length > 0 && !canGive && (
          <p data-testid="tribute-give-invalid-reason" className="text-xs text-red-500">
            Select exactly one card tied for your highest eligible rank.
          </p>
        )}
        {submittedCard && (
          <p data-testid="submitted-tribute-card" className="text-sm font-semibold text-green-700">
            Submitted: {submittedCard.rank} of {submittedCard.suit}
          </p>
        )}
      </div>
    </MockGameFrame>
  );
}
