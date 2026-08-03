"use client";

// CardExchangeModal for a giver-only player (position 3, Dave) - gave a
// tribute card but received nothing back, so there's nothing to submit, just
// their hand to look at while waiting. See /mocks for the full scenario list.

import CardExchangeModal from "@/components/game/CardExchangeModal";
import { mockCardExchangeInitial, mockHand, mockIdleRound, mockParticipants } from "@/mocks/gameFixtures";
import MockGameFrame from "../../_components/MockGameFrame";

export default function CardExchangeGiverOnlyPreviewPage() {
  return (
    <MockGameFrame round={mockIdleRound} participants={mockParticipants} myPosition={3}>
      <CardExchangeModal
        myPosition={3}
        hand={mockHand}
        participants={mockParticipants}
        initialExchanges={mockCardExchangeInitial}
        onSubmitReturn={() => {}}
      />
    </MockGameFrame>
  );
}
