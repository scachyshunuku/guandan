"use client";

import { useState } from "react";
import type {
  Card,
  CardExchangeActionData,
  CardWithWild,
  GameParticipant,
  PlayerPosition,
} from "@/lib/types";
import { nameForPosition } from "@/lib/format";
import CardComponent from "./Card";

export interface CardExchangeModalProps {
  myPosition: PlayerPosition;
  // Current hand, already including whatever this player received in the
  // initial exchange (that part is automatic — ARCHITECTURE.md "Card
  // Exchange Phase" — by the time this modal is shown). RULES.md "Card
  // Exchange": this is the hand freshly dealt for the round about to be
  // played, not whatever was left over from the hand that just ended.
  hand: CardWithWild[];
  // For name lookups only (RULES.md "Card Exchange": exchanges are visible
  // to everyone, by name, not by raw seat number).
  participants: GameParticipant[];
  // This round's `type: 'initial'` exchange actions, all of them — RULES.md
  // "Card Exchange": "All card exchanges are visible to all players," so
  // every entry is shown regardless of who it involves, not just the
  // viewer's own.
  initialExchanges: CardExchangeActionData[];
  // Just the card: the server (exchange-cards/route.ts) derives who it goes
  // back to from the 'initial' card_exchange history itself, the same
  // owedTo lookup this component does below purely for display.
  onSubmitReturn: (card: Card) => void;
  isSubmitting?: boolean;
}

// Card exchange phase UI: shows the (already-automatic) initial exchange
// read-only, then, if the viewer received a card, lets them pick one from
// their hand to give back to whoever gave it to them (RULES.md "Card
// Exchange" — the return exchange is the only exchange step a player
// actively chooses). Players who didn't receive a card (3rd/4th place, who
// only gave) have nothing to submit here.
export default function CardExchangeModal({
  myPosition,
  hand,
  participants,
  initialExchanges,
  onSubmitReturn,
  isSubmitting = false,
}: CardExchangeModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const owedTo = initialExchanges.find((exchange) => exchange.to === myPosition);

  return (
    <div data-testid="card-exchange-modal" className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
      <h2 className="text-sm font-semibold text-gray-900">Card Exchange</h2>

      <ul data-testid="initial-exchange-list" className="flex flex-col gap-1">
        {initialExchanges.map((exchange, index) => (
          <li
            key={index}
            data-testid="initial-exchange-entry"
            className="flex items-center gap-2 text-xs text-gray-600"
          >
            <span>
              {nameForPosition(exchange.from, participants)} → {nameForPosition(exchange.to, participants)}
            </span>
            <CardComponent card={exchange.card} />
          </li>
        ))}
      </ul>

      {owedTo ? (
        <>
          <p data-testid="return-prompt" className="text-sm text-gray-700">
            Choose a card to give back to {nameForPosition(owedTo.from, participants)}
          </p>
          <div data-testid="return-card-options" className="flex flex-wrap gap-1">
            {hand.map((card, index) => (
              <CardComponent
                key={index}
                card={card}
                selected={selectedIndex === index}
                onClick={() => setSelectedIndex(index)}
              />
            ))}
          </div>
          <button
            type="button"
            data-testid="submit-return-button"
            disabled={selectedIndex === null || isSubmitting}
            onClick={() => {
              if (selectedIndex !== null) onSubmitReturn(hand[selectedIndex]);
            }}
            className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Submit
          </button>
        </>
      ) : (
        <>
          <p data-testid="no-return-needed" className="text-sm text-gray-500">
            Waiting for other players to exchange cards…
          </p>
          {/* No return owed (3rd/4th place, who only gave) — shown
              read-only so a giver can still see their whole new hand,
              same as a recipient choosing a return card above. */}
          <div data-testid="own-hand-preview" className="flex flex-wrap gap-1">
            {hand.map((card, index) => (
              <CardComponent key={index} card={card} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
