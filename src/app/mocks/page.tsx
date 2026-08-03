import Link from "next/link";

// Landing page for the DB-free /mocks previews - a jumping-off point to
// every scenario without going through the real create-game/join/
// fill-with-bots/start flow. Add a link here whenever a new preview scenario
// is added.
const SCENARIOS: { href: string; label: string; description: string }[] = [
  {
    href: "/mocks/game-preview",
    label: "Game Play",
    description: "Live-round layout: your hand, the table, and an interactive play/pass loop.",
  },
  {
    href: "/mocks/card-exchange-preview/recipient",
    label: "Card Exchange — Owes a Return",
    description: "Recipient of tribute picks a card to give back from their (reorderable) hand.",
  },
  {
    href: "/mocks/card-exchange-preview/giver-only",
    label: "Card Exchange — Gave Only",
    description: "3rd/4th place, who received nothing back, waiting on the others.",
  },
  {
    href: "/mocks/card-exchange-preview/giver-choice",
    label: "Card Exchange — Chooses Tribute",
    description: "3rd/4th place chooses between tied best cards to send into the 1st/2nd-place exchange.",
  },
  {
    href: "/mocks/card-exchange-preview/tribute-choice",
    label: "Card Exchange — Tied Tribute (Picks)",
    description: "1st place chooses which of two tied tribute cards to take.",
  },
  {
    href: "/mocks/card-exchange-preview/tribute-wait",
    label: "Card Exchange — Tied Tribute (Waits)",
    description: "Everyone else, watching 1st place resolve the tie.",
  },
];

export default function MocksIndexPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 bg-slate-100 px-4 py-12">
      <h1 className="text-lg font-semibold text-slate-900">Mock Previews</h1>
      <p className="text-sm text-slate-600">
        DB-free scenarios for eyeballing UI changes without a live game.
      </p>
      <ul data-testid="mocks-scenario-list" className="flex flex-col gap-3">
        {SCENARIOS.map((scenario) => (
          <li key={scenario.href}>
            <Link
              href={scenario.href}
              data-testid="mocks-scenario-link"
              className="block rounded-lg bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <p className="text-sm font-semibold text-blue-700">{scenario.label}</p>
              <p className="text-xs text-slate-500">{scenario.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
