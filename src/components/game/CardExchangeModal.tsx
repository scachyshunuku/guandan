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
import PlayerHand from "./PlayerHand";

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
  // This round's `type: 'initial'` exchange actions, all of them - used only
  // to work out whether the viewer owes a return and to whom. The exchanges
  // themselves are visible to everyone via the game history log (GameHistory
  // already renders every `card_exchange` action, `initial` and `return`
  // alike), so this component doesn't duplicate that display.
  initialExchanges: CardExchangeActionData[];
  // Just the card: the server (exchange-cards/route.ts) derives who it goes
  // back to from the 'initial' card_exchange history itself, the same
  // owedTo lookup this component does below purely for display.
  onSubmitReturn: (card: Card) => void;
  isSubmitting?: boolean;
  // Threaded into PlayerHand's drag-order persistence (same key it uses
  // once play begins), so a rearrangement made while picking the return
  // card is still in place on the live hand right after. Omitted by tests/
  // previews that don't need persistence across mounts, same as PlayerHand
  // itself.
  gameId?: string;
  initialServerOrder?: string[] | null;
  onOrderChange?: (order: string[]) => void;
}

// Card exchange phase UI: if the viewer received a card, lets them pick one
// from their hand to give back to whoever gave it to them (RULES.md "Card
// Exchange" — the return exchange is the only exchange step a player
// actively chooses). Players who didn't receive a card (3rd/4th place, who
// only gave) have nothing to submit here, just their hand to look at. Styled
// to match the live-play hand panel exactly (same PlayerHand, same
// instruction-then-button layout below it, no separate card/box chrome) so
// this doesn't read as a distinct "modal" - the initial exchange itself is
// visible via the game history log rather than repeated here.
export default function CardExchangeModal({
  myPosition,
  hand,
  participants,
  initialExchanges,
  onSubmitReturn,
  isSubmitting = false,
  gameId,
  initialServerOrder,
  onOrderChange,
}: CardExchangeModalProps) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  const owedTo = initialExchanges.find((exchange) => exchange.to === myPosition);

  return (
    <div data-testid="card-exchange-modal" className="flex w-full flex-col items-start gap-3">
      {owedTo ? (
        <>
          <div data-testid="return-card-options">
            <PlayerHand
              hand={hand}
              isOwnHand
              selectedIndices={selectedIndices}
              onSelectionChange={setSelectedIndices}
              persistenceKey={gameId ? `${gameId}:${myPosition}` : undefined}
              initialServerOrder={initialServerOrder}
              onOrderChange={onOrderChange}
            />
          </div>
          <div data-testid="return-card-controls" className="flex flex-col items-start gap-2">
            <p data-testid="return-prompt" className="text-sm text-slate-700">
              Choose a card to give back to {nameForPosition(owedTo.from, participants)}
            </p>
            <button
              type="button"
              data-testid="submit-return-button"
              disabled={selectedIndices.length !== 1 || isSubmitting}
              onClick={() => {
                if (selectedIndices.length === 1) onSubmitReturn(hand[selectedIndices[0]]);
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Submit
            </button>
            {selectedIndices.length > 1 && (
              <p data-testid="return-card-invalid-reason" className="text-xs text-red-500">
                Select exactly one card to give back.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {/* No return owed (3rd/4th place, who only gave) — the hand is
              still shown, draggable, same as a recipient's above; there's
              just nothing to submit. */}
          <div data-testid="own-hand-preview">
            <PlayerHand hand={hand} isOwnHand />
          </div>
          <p data-testid="no-return-needed" className="text-sm text-slate-500">
            Waiting for other players to exchange cards…
          </p>
        </>
      )}
    </div>
  );
}
