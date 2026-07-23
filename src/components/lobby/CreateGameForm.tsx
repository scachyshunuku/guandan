"use client";

import { useState } from "react";
import Link from "next/link";
import { gameShareLink } from "@/lib/format";

export interface CreateGameFormProps {
  onCreateGame: () => void;
  isCreating?: boolean;
  error?: string | null;
  // Set once the game has been created (ARCHITECTURE.md "Create Game" step
  // 2-3) - the id both identifies the game and is its shareable code, so
  // there's nothing else to wait on before showing the link.
  gameId?: string | null;
}

// Presentational: the actual POST /api/game/create call is the caller's job
// (matches ActionButtons.tsx/CardExchangeModal.tsx - components fire a
// callback, a page or hook does the network request), so this component
// stays easy to test without mocking fetch.
export default function CreateGameForm({
  onCreateGame,
  isCreating = false,
  error = null,
  gameId = null,
}: CreateGameFormProps) {
  const [copied, setCopied] = useState(false);

  if (gameId) {
    const joinLink = gameShareLink(gameId);

    return (
      <div data-testid="create-game-form" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Share this link with the other players:
          <div className="flex items-center gap-2">
            <input
              data-testid="game-link-input"
              readOnly
              value={joinLink}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="button"
              data-testid="copy-link-button"
              onClick={async () => {
                await navigator.clipboard.writeText(joinLink);
                setCopied(true);
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              <span aria-live="polite">{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>
        </label>
        <Link
          href={`/game/${gameId}`}
          data-testid="enter-game-link"
          className="self-start text-sm font-semibold text-indigo-600"
        >
          Enter game &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="create-game-form" className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="create-game-button"
        disabled={isCreating}
        onClick={onCreateGame}
        className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isCreating ? "Creating…" : "Create Game"}
      </button>
      {error && (
        <p data-testid="create-game-error" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
