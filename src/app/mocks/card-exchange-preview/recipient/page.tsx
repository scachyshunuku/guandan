"use client";

// CardExchangeModal as a recipient (position 0, Alice) - owes a return card
// to whoever gave her one, rendered inside the same MockGameFrame as every
// other /mocks preview so it's directly comparable to a live round. See
// /mocks for the full scenario list.

import { useState } from "react";
import CardExchangeModal from "@/components/game/CardExchangeModal";
import type { Card } from "@/lib/types";
import { mockCardExchangeInitial, mockHand, mockIdleRound, mockParticipants } from "@/mocks/gameFixtures";
import MockGameFrame from "../../_components/MockGameFrame";

export default function CardExchangeRecipientPreviewPage() {
  const [submitted, setSubmitted] = useState<Card | null>(null);

  return (
    <MockGameFrame round={mockIdleRound} participants={mockParticipants} myPosition={0}>
      <CardExchangeModal
        myPosition={0}
        hand={mockHand}
        participants={mockParticipants}
        initialExchanges={mockCardExchangeInitial}
        onSubmitReturn={setSubmitted}
      />
      {submitted && (
        <p data-testid="submitted-card" className="text-sm font-semibold text-green-700">
          Submitted: {submitted.rank} of {submitted.suit}
        </p>
      )}
    </MockGameFrame>
  );
}
