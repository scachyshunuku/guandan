"use client";

import { useState, type FormEvent } from "react";

export interface JoinGameFormProps {
  onJoinGame: (gameId: string, playerName: string) => void;
  isJoining?: boolean;
  error?: string | null;
  // Prefills the game code, e.g. when this form is reached via a
  // /game/[id] link that already carries the code (ARCHITECTURE.md
  // "Join Game" step 1: "Guest clicks invite link or enters code").
  initialGameId?: string;
}

// Presentational, like CreateGameForm.tsx: validates locally (both fields
// required) so an incomplete submit never reaches the caller, but leaves the
// actual POST /api/game/[id]/join call to whoever renders this.
export default function JoinGameForm({
  onJoinGame,
  isJoining = false,
  error = null,
  initialGameId = "",
}: JoinGameFormProps) {
  const [gameId, setGameId] = useState(initialGameId);
  const [playerName, setPlayerName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedGameId = gameId.trim();
    const trimmedPlayerName = playerName.trim();
    if (!trimmedGameId || !trimmedPlayerName) {
      setValidationError("Game code and player name are required");
      return;
    }
    setValidationError(null);
    onJoinGame(trimmedGameId, trimmedPlayerName);
  };

  return (
    <form data-testid="join-game-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Game code
        <input
          data-testid="game-id-input"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          placeholder="Paste the game code"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Player name
        <input
          data-testid="player-name-input"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Your name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </label>
      <button
        type="submit"
        data-testid="join-game-button"
        disabled={isJoining}
        className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isJoining ? "Joining…" : "Join Game"}
      </button>
      {(validationError || error) && (
        <p data-testid="join-game-error" className="text-sm text-red-500">
          {validationError ?? error}
        </p>
      )}
    </form>
  );
}
