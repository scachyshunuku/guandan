"use client";

// TributeChoiceModal as 1st place (position 0, Alice) - 3rd and 4th place's
// tribute cards tied in rank (RULES.md "Two-Team Lead"), so she picks which
// one to take. Floats over her own (still draggable) hand, same as the real
// game page, so she can compare against it while deciding. See /mocks for
// the full scenario list.

import { useState } from "react";
import PlayerHand from "@/components/game/PlayerHand";
import TributeChoiceModal from "@/components/game/TributeChoiceModal";
import type { PlayerPosition } from "@/lib/types";
import { mockHand, mockIdleRound, mockParticipants, mockTributeChoice } from "@/mocks/gameFixtures";
import MockGameFrame from "../../_components/MockGameFrame";

export default function CardExchangeTributeChoicePreviewPage() {
  const [took, setTook] = useState<PlayerPosition | null>(null);

  return (
    <MockGameFrame
      round={mockIdleRound}
      participants={mockParticipants}
      myPosition={0}
      overlay={
        <TributeChoiceModal
          thirdPosition={mockTributeChoice.thirdPosition}
          thirdCard={mockTributeChoice.thirdCard}
          fourthPosition={mockTributeChoice.fourthPosition}
          fourthCard={mockTributeChoice.fourthCard}
          participants={mockParticipants}
          isFirstPlace
          onChoose={setTook}
        />
      }
    >
      <PlayerHand hand={mockHand} isOwnHand />
      {took !== null && (
        <p data-testid="submitted-take" className="text-sm font-semibold text-green-700">
          Took from position {took}
        </p>
      )}
    </MockGameFrame>
  );
}
