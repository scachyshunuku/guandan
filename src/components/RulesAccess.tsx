"use client";

import { useState } from "react";
import RulesModal from "@/components/game/RulesModal";

// The rules entry point belongs in the root app shell so it remains available
// before a game exists as well as in the waiting room and active game.
export default function RulesAccess() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="rules-open-button"
        onClick={() => setIsOpen(true)}
        className="fixed top-3 right-3 z-40 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:top-4 sm:right-4"
      >
        Rules
      </button>
      {isOpen && <RulesModal onClose={() => setIsOpen(false)} />}
    </>
  );
}
