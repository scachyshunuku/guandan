import type { ReactNode } from "react";
import GameProvider from "./GameProvider";

// Server component: only job is to await the dynamic route param and hand
// the plain gameId string down to the client-side GameProvider (which owns
// useGame + localStorage access - both client-only, see its doc comment).
export default async function GameLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: gameId } = await params;
  return <GameProvider gameId={gameId}>{children}</GameProvider>;
}
