"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CreateGameForm from "@/components/lobby/CreateGameForm";
import JoinGameForm from "@/components/lobby/JoinGameForm";
import { postJson } from "@/lib/httpClient";
import { getOrCreatePlayerId } from "@/lib/playerId";
import type { CreateGameResponse, JoinGameResponse } from "@/lib/types";

// Home page (ARCHITECTURE.md section 7 "Create Game"/"Join Game", Task 5.5).
// Owns the network calls and navigation for both lobby forms - the forms
// themselves stay presentational (see CreateGameForm.tsx/JoinGameForm.tsx).
export default function Home() {
  const router = useRouter();

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdGameId, setCreatedGameId] = useState<string | null>(null);

  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleCreateGame = async () => {
    setIsCreating(true);
    setCreateError(null);
    try {
      const { gameId } = await postJson<CreateGameResponse>("/api/game/create");
      setCreatedGameId(gameId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create game");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinGame = async (gameId: string, playerName: string) => {
    setIsJoining(true);
    setJoinError(null);
    try {
      const playerId = getOrCreatePlayerId();
      await postJson<JoinGameResponse>(`/api/game/${encodeURIComponent(gameId)}/join`, {
        playerName,
        playerId,
      });
      router.push(`/game/${encodeURIComponent(gameId)}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join game");
      setIsJoining(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-100 px-6 py-16">
      <main className="flex w-full max-w-3xl flex-col gap-10">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Guandan
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Play with friends</h1>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Create a game</h2>
            <CreateGameForm
              onCreateGame={handleCreateGame}
              isCreating={isCreating}
              error={createError}
              gameId={createdGameId}
            />
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Join a game</h2>
            <JoinGameForm onJoinGame={handleJoinGame} isJoining={isJoining} error={joinError} />
          </section>
        </div>
      </main>
    </div>
  );
}
