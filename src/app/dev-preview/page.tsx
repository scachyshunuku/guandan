"use client";

import { useState } from "react";
import Card from "@/components/game/Card";
import PlayerHand from "@/components/game/PlayerHand";
import type { CardWithWild } from "@/lib/types";

const hand: CardWithWild[] = [
  { suit: "SPADES", rank: "QUEEN" },
  { suit: "HEARTS", rank: "5", actsAs: { suit: "SPADES", rank: "QUEEN" } },
  { suit: "CLUBS", rank: "10" },
  { suit: "DIAMONDS", rank: "ACE" },
  { rank: "BLACK_JOKER" },
  { rank: "RED_JOKER" },
];

export default function DevPreviewPage() {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

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
      </div>
    </main>
  );
}
