"use client";

// TributeChoiceModal as a non-1st-place player (position 1, Bob) - the tied
// tribute cards are 3rd/4th's to sort out via 1st place's choice, so Bob
// just watches and waits, with his own hand still visible underneath. See
// /mocks for the full scenario list.

import PlayerHand from "@/components/game/PlayerHand";
import TributeChoiceModal from "@/components/game/TributeChoiceModal";
import { mockHand, mockIdleRound, mockParticipants, mockTributeChoice } from "@/mocks/gameFixtures";
import MockGameFrame from "../../_components/MockGameFrame";

export default function CardExchangeTributeWaitPreviewPage() {
  return (
    <MockGameFrame
      round={mockIdleRound}
      participants={mockParticipants}
      myPosition={1}
      overlay={
        <TributeChoiceModal
          thirdPosition={mockTributeChoice.thirdPosition}
          thirdCard={mockTributeChoice.thirdCard}
          fourthPosition={mockTributeChoice.fourthPosition}
          fourthCard={mockTributeChoice.fourthCard}
          participants={mockParticipants}
          isFirstPlace={false}
          onChoose={() => {}}
        />
      }
    >
      <PlayerHand hand={mockHand} isOwnHand />
    </MockGameFrame>
  );
}
