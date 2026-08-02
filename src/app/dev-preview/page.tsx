"use client";

import { useRef, useState } from "react";
import Card from "@/components/game/Card";
import PlayerHand, {
  startHandPanelMarquee,
  type PlayerHandHandle,
} from "@/components/game/PlayerHand";
import ActionButtons from "@/components/game/ActionButtons";
import { STANDARD_RANK_ORDER } from "@/lib/cardUtils";
import type { CardWithWild } from "@/lib/types";

const hand: CardWithWild[] = [
  { suit: "SPADES", rank: "QUEEN" },
  { suit: "HEARTS", rank: "5", actsAs: { suit: "SPADES", rank: "QUEEN" } },
  { suit: "CLUBS", rank: "10" },
  { suit: "DIAMONDS", rank: "ACE" },
  { rank: "BLACK_JOKER" },
  { rank: "RED_JOKER" },
];

// A realistically-sized hand (27 cards, matching what a player actually
// holds mid-game - see the "21 cards" / "26 cards" counts in a real round)
// for exercising multiselect drag, marquee select, and the FLIP reflow with
// enough cards that a single-card-width gap is actually visible against the
// rest of the row, not just a two-card demo hand.
const bigHand: CardWithWild[] = [
  ...STANDARD_RANK_ORDER.flatMap((rank) => [
    { suit: "CLUBS", rank } as CardWithWild,
    { suit: "HEARTS", rank } as CardWithWild,
  ]),
  { rank: "BLACK_JOKER" },
];

export default function DevPreviewPage() {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [panelSelectedIndices, setPanelSelectedIndices] = useState<number[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const playerHandRef = useRef<PlayerHandHandle>(null);

  const panelSelectedCards = panelSelectedIndices.map((i) => bigHand[i]);

  return (
    <main className="min-h-screen bg-slate-100 px-8 py-12 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Guandan
          </p>
          <h1 className="mt-2 text-3xl font-bold">SVG card preview</h1>
          <p className="mt-2 text-slate-600">Compact card-code assets rendered by Card.tsx.</p>
        </header>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Individual cards</h2>
          <div className="flex flex-wrap gap-3">
            <Card card={{ suit: "HEARTS", rank: "ACE" }} />
            <Card card={{ suit: "CLUBS", rank: "KING" }} />
            <Card card={{ suit: "SPADES", rank: "QUEEN" }} />
            <Card card={{ rank: "BLACK_JOKER" }} />
            <Card card={{ rank: "RED_JOKER" }} />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Your hand</h2>
          <p className="mb-4 text-sm text-slate-600">Select cards to verify the SVGs and selection styling.</p>
          <PlayerHand
            hand={hand}
            selectedIndices={selectedIndices}
            onSelectionChange={setSelectedIndices}
          />
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Opponent hand</h2>
          <PlayerHand hand={hand.slice(0, 4)} isOwnHand={false} />
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Full panel (matches the real game layout)</h2>
          <p className="mb-4 text-sm text-slate-600">
            A {bigHand.length}-card hand wrapped exactly like{" "}
            <code>app/game/[id]/page.tsx</code> - multiselect drag, the hold/drag
            lift animation, and marquee box-select across the whole panel
            (cards + Play/Pass, not just the card row) all work here without a
            live game. Click to select, shift-click for a range, drag a
            selected card to move the group, or drag from empty space in this
            panel - including around/below the buttons - to box-select.
          </p>
          <div
            data-testid="full-panel-demo"
            className="flex w-full flex-col items-start gap-3 rounded-xl border border-dashed border-slate-300 p-4"
            onPointerDown={(event) => startHandPanelMarquee(event, playerHandRef)}
          >
            <PlayerHand
              ref={playerHandRef}
              hand={bigHand}
              selectedIndices={panelSelectedIndices}
              onSelectionChange={setPanelSelectedIndices}
            />
            <ActionButtons
              hand={bigHand}
              selectedCards={panelSelectedCards}
              currentTrick={[]}
              levelRank="2"
              isMyTurn
              onPlay={(cards) => setLastAction(`Play: ${cards.length} card(s)`)}
              onPass={() => setLastAction("Pass")}
            />
            {lastAction && (
              <p className="text-sm text-slate-600">Last action: {lastAction}</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
