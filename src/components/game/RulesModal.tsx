"use client";

import { useEffect, useRef } from "react";

export interface RulesModalProps {
  onClose: () => void;
}

interface Section {
  id: string;
  label: string;
  content: React.ReactNode;
}

function TributeLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      href="#rules-section-exchange"
      className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
    >
      {children}
    </a>
  );
}

// Condensed, skimmable restatement of RULES.md for in-game reference. It is not a
// verbatim copy. Sections are arranged for quick in-game lookup so anyone
// cross-checking against that file can follow along. Wording is trimmed down
// to what a player mid-game actually needs (full sentences of rationale in
// RULES.md itself are dropped in favor of the fact alone).
const SECTIONS: Section[] = [
  {
    id: "overview",
    label: "Overview",
    content: (
      <>
        <p>
          Guandan is a trick-taking partnership game for four players in two fixed
          teams. Partners sit opposite each other:
        </p>
        <ul className="list-disc pl-5">
          <li>Team A: seats 1 &amp; 3</li>
          <li>Team B: seats 2 &amp; 4</li>
        </ul>
        <p>
          It uses a double deck (108 cards total: 2 standard 52-card decks +
          4 jokers), and teams climb through 13 levels, from 2 up to Ace, by
          winning hands.
        </p>
      </>
    ),
  },
  {
    id: "cards",
    label: "The Cards",
    content: (
      <>
        <p className="font-medium text-gray-900">Ranking, highest to lowest:</p>
        <p className="rounded-md bg-gray-50 px-3 py-2 font-mono text-xs">
          Red Joker &gt; Black Joker &gt; A &gt; K &gt; Q &gt; J &gt; 10 &gt; 9
          &gt; 8 &gt; 7 &gt; 6 &gt; 5 &gt; 4 &gt; 3 &gt; 2
        </p>
        <p>
          Two cards of the same rank are equivalent. Suit never breaks a tie.
        </p>
      </>
    ),
  },
  {
    id: "level-wild",
    label: "Level Cards & Wild Hearts",
    content: (
      <>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Whatever rank a team is currently playing at becomes that hand&apos;s
            <strong> level card</strong>, ranked above Ace, below Black Joker.
          </li>
          <li>
            <strong>Hearts level cards are wild</strong>: they can represent
            any card except a joker. Example: at level 5, the 5 of hearts can
            be played as anything except a joker.
          </li>
          <li>
            <strong>
              Wild hearts are exempt from <TributeLink>tribute</TributeLink>
            </strong>{" "}
            when giving
            your best card in the card exchange, a hearts level card is never
            eligible; your best non-wild card is used instead.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "dealing",
    label: "Dealing",
    content: (
      <ul className="list-disc space-y-1 pl-5">
        <li>All 108 cards are shuffled and dealt fresh each round.</li>
        <li>Each player gets 27 cards, dealt all at once.</li>
      </ul>
    ),
  },
  {
    id: "leader",
    label: "Who Leads",
    content: (
      <ul className="list-disc space-y-1 pl-5">
        <li>First round: a random player leads.</li>
        <li>
          Subsequent rounds: whoever <em>gave up</em> the <TributeLink>tribute</TributeLink>{" "}
          card that went to 1st place leads.
        </li>
        <li>
          If <TributeLink>tribute</TributeLink> was cancelled, 1st place leads
          instead.
        </li>
        <li>
          Within a round: whoever wins a trick leads the next one. If the
          winner of the trick finished their hand, their partner leads instead.
        </li>
      </ul>
    ),
  },
  {
    id: "trick",
    label: "How a Trick Works",
    content: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <strong>Lead</strong>: one player opens with a combination or bomb.
        </li>
        <li>
          <strong>Respond</strong>: each other player, in turn, must play a
          higher combination of the same type, or any bomb, or pass.
        </li>
        <li>
          <strong>End</strong>: the trick ends after three consecutive
          passes.
        </li>
        <li>
          <strong>Winner</strong>: whoever played last wins the trick and
          leads the next one.
        </li>
      </ol>
    ),
  },
  {
    id: "combinations",
    label: "Valid Combinations",
    content: (
      <>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 font-medium">Shape</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Single</td>
              <td className="py-1">One card</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Pair</td>
              <td className="py-1">Two of the same rank</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Triple</td>
              <td className="py-1">Three of the same rank</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Full house</td>
              <td className="py-1">
                Triple + a pair (e.g. 3-3-3-7-7)
                <span className="text-gray-500">; compare the triple only.</span>
              </td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Straight</td>
              <td className="py-1">
                Exactly 5 consecutive ranks, any suits (Ace can play low: A-2-3-4-5)
              </td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Tube</td>
              <td className="py-1">3 consecutive pairs (e.g. 3-3-4-4-5-5)</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">Plate</td>
              <td className="py-1">2 consecutive triples (e.g. 3-3-3-4-4-4)</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500">
          Straights, tubes, and plates can&apos;t wrap around both ends at once
          (K-A-2 and J-Q-K-A-2 are both invalid).
        </p>
      </>
    ),
  },
  {
    id: "bombs",
    label: "Bombs",
    content: (
      <>
        <p>
          Bombs beat any ordinary combination, and beat a lower bomb of the
          same family. Lowest to highest:
        </p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>Quadruple (four of a kind)</li>
          <li>Five of a kind</li>
          <li>Straight flush (5 consecutive cards, same suit)</li>
          <li>Six of a kind</li>
          <li>Seven of a kind</li>
          <li>Eight of a kind</li>
          <li>Nine of a kind</li>
          <li>Ten of a kind</li>
          <li>Joker bomb (all four jokers)</li>
        </ol>
        <p>
          Bombs can be played on your turn in response to any ordinary
          combination or a lower-ranked bomb.
          A bomb can also lead a trick.
        </p>
      </>
    ),
  },
  {
    id: "scoring",
    label: "Scoring & Promotion",
    content: (
      <>
        <p className="font-medium text-gray-900">
          A hand ends once the outcome is decided:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Once 3 players finish, the 4th is automatically last.</li>
          <li>
            If the first two players to finish are partners (a 1-2 finish),
            the round ends immediately.
          </li>
        </ul>
        <table className="mt-2 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-1 pr-2 font-medium">Finish</th>
              <th className="py-1 font-medium">Levels gained</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">1st &amp; 2nd (1-2)</td>
              <td className="py-1">4 levels</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">1st &amp; 3rd (1-3)</td>
              <td className="py-1">2 levels</td>
            </tr>
            <tr>
              <td className="py-1 pr-2 font-medium text-gray-900">1st &amp; 4th (1-4)</td>
              <td className="py-1">1 level</td>
            </tr>
          </tbody>
        </table>
        <p>Levels run 2 → 3 → … → K → A (13 total). Ace is the highest.</p>
      </>
    ),
  },
  {
    id: "winning",
    label: "Winning the Game",
    content: (
      <p>
        A team wins by achieving a 1-2 or 1-3 finish <em>while playing at
        level Ace</em>. If they reach Ace but don&apos;t manage that finish, they
        stay at Ace and keep playing hands until they do.
      </p>
    ),
  },
  {
    id: "exchange",
    label: "Tributes",
    content: (
      <>
        <p>
          After each round, the next round&apos;s 27 cards are dealt.
          Tribute is exchanged against that fresh hand, and it&apos;s visible to
          everyone.
        </p>
        <p className="font-medium text-gray-900">
          Single-team lead (1-3 or 1-4 finish):
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>4th place gives their best card to 1st place.</li>
          <li>1st place gives any card back to 4th place.</li>
          <li>
            Cancelled if 4th place alone holds both Red Jokers. Nothing changes
            hands.
          </li>
        </ul>
        <p className="font-medium text-gray-900">Two-team lead (1-2 finish):</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Both 3rd and 4th place give their best card.</li>
          <li>The higher card goes to 1st place, the lower to 2nd place.</li>
          <li>Tied ranks: 1st place chooses which card to take.</li>
          <li>1st and 2nd place each give a card back to whoever gave to them.</li>
          <li>
            Cancelled if 3rd and 4th place hold both Red Jokers between them.
            Nothing changes hands.
          </li>
        </ul>
      </>
    ),
  },
];

const SECTION_ORDER = [
  "overview",
  "dealing",
  "leader",
  "trick",
  "combinations",
  "bombs",
  "cards",
  "level-wild",
  "scoring",
  "winning",
  "exchange",
] as const;

const ORDERED_SECTIONS = SECTION_ORDER.map((id) =>
  SECTIONS.find((section) => section.id === id),
).filter((section): section is Section => section !== undefined);

// Overlay dialog, not one of the inline round-status panels this file's
// siblings (CardExchangeModal, TributeChoiceModal, WildCardSelector) render
// in the page's action-area slot. This needs to open on top of the board
// from anywhere without displacing whatever's actually going on in the
// round, and closes back to exactly that same state.
export default function RulesModal({ onClose }: RulesModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function scrollToSection(id: string) {
    const container = contentRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div
      data-testid="rules-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-testid="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Guandan rules"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Guandan Rules</h2>
          <button
            type="button"
            data-testid="rules-modal-close-button"
            aria-label="Close rules"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            data-testid="rules-modal-toc"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-2 py-2 sm:w-44 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-2 sm:py-3"
          >
            {ORDERED_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                data-testid="rules-modal-toc-item"
                onClick={() => scrollToSection(section.id)}
                className="shrink-0 rounded-md px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap text-gray-600 hover:bg-gray-100 hover:text-gray-900 sm:whitespace-normal"
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div
            ref={contentRef}
            data-testid="rules-modal-content"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pr-6"
          >
            {ORDERED_SECTIONS.map((section) => (
              <section
                key={section.id}
                id={`rules-section-${section.id}`}
                data-section-id={section.id}
                data-testid="rules-modal-section"
                className="scroll-mt-2 border-b border-gray-100 py-3 first:pt-0 last:border-b-0"
              >
                <h3 className="mb-1.5 text-sm font-semibold text-gray-900">
                  {section.label}
                </h3>
                <div className="flex flex-col gap-1.5 text-sm text-gray-700">
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
