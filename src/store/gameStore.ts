// Local client-side game state, kept in sync with the server via
// useGameRealtimeSync (Task 4.2). See ARCHITECTURE.md section 6 ("State
// Management") for the original sketch this refines against the concrete
// types in lib/types.ts.
import { create } from "zustand";
import type {
  CurrentTrick,
  GameAction,
  GameParticipant,
  GameRound,
  GameStatus,
  PlayerPosition,
  RoundStatus,
  Team,
  CardWithWild,
} from "@/lib/types";

export interface GameStoreState {
  // Also the shareable code used in URLs - Game.id doubles as the game code
  // (ARCHITECTURE.md "Game Code"), there's no separate short-code column.
  gameId: string | null;
  gameStatus: GameStatus;

  // All rows from game_participants, seated players and spectators alike
  // (spectators are the ones with position === null). Kept as one list
  // rather than split arrays so there's a single source of truth to sync
  // from the server - see getSpectators/getSeatedParticipants below.
  participants: GameParticipant[];
  myPlayerId: string | null;
  myPosition: PlayerPosition | null;

  hand: CardWithWild[];
  currentTrick: CurrentTrick;
  currentPlayerTurn: PlayerPosition | null;

  // The round the fields below describe — used to detect a fresh round
  // (startNextRound's insert) so roundActions can be reset rather than
  // carrying over the previous round's card-exchange history.
  roundId: string | null;
  roundStatus: RoundStatus;
  // Mirrors GameRound.finishingPositions — null only until startNextRound
  // deals this round (RULES.md "Card Exchange": every round carries the
  // *previous* hand's finishing order from the moment it's created, not
  // just once *this* round itself concludes). CardExchangeModal/
  // TributeChoiceModal need this to know who's 1st/2nd/3rd/4th without
  // re-deriving it client-side.
  finishingPositions: number[] | null;
  // Mirrors GameRound.gameState.pendingTributeChoice — set only while
  // roundStatus is 'awaiting_tribute_choice' (RULES.md "Two-Team Lead").
  pendingTributeChoice: GameRound["gameState"]["pendingTributeChoice"] | null;
  // Mirrors GameRound.gameState.pendingGiverChoice — set only while
  // roundStatus is 'awaiting_giver_choice' (RULES.md "Card Exchange" ->
  // "Best card, when tied"). `pendingPositions` here is safe to broadcast
  // to everyone (unlike each giver's actual candidate cards, which the
  // viewer derives client-side from their own private hand).
  pendingGiverChoice: GameRound["gameState"]["pendingGiverChoice"] | null;
  // This round's game_actions (all types, matching GameStateResponse.
  // roundActions) — hydrated on load, appended to via `game_action`
  // broadcasts, and reset whenever roundId changes. CardExchangeModal reads
  // the 'card_exchange'/'initial' entries out of this to show who owes whom.
  roundActions: GameAction[];

  // Indexed by Team (0 = team A, 1 = team B), mirrors Game.teamALevel/teamBLevel.
  teamLevels: [number, number];
  // Mirrors Game.winningTeam — null until the game reaches status
  // 'completed' (RULES.md "Winning the Game").
  winningTeam: Team | null;

  setGame: (gameId: string, myPlayerId: string) => void;
  setGameStatus: (status: GameStatus) => void;
  setMyPosition: (position: PlayerPosition | null) => void;
  setHand: (hand: CardWithWild[]) => void;
  updateTrick: (currentTrick: CurrentTrick) => void;
  setCurrentPlayerTurn: (position: PlayerPosition | null) => void;
  // The full round_updated payload (initial hydration and every broadcast) —
  // supersedes updateTrick/setCurrentPlayerTurn for that purpose, which
  // remain in use for optimistic local updates (useGame's playCards/pass)
  // that only ever touch trick state, never a round's other metadata.
  applyRoundUpdate: (round: GameRound) => void;
  appendRoundAction: (action: GameAction) => void;
  setRoundActions: (actions: GameAction[]) => void;
  updateParticipants: (participants: GameParticipant[]) => void;
  addParticipant: (participant: GameParticipant) => void;
  // Adjusts handCount by seat position rather than participant id - fed by
  // useGame.ts's handleGameAction, which only ever has a card_played/
  // card_exchange action's `position`/`from`/`to` fields to work with, not
  // full participant rows. Deliberately not a broadcast of its own: those
  // action types are already public (history/route.ts) and already
  // broadcast in full, so this derives the delta from data already in
  // flight instead of adding a redundant server round-trip.
  adjustHandCounts: (deltas: readonly { position: PlayerPosition; delta: number }[]) => void;
  setTeamLevels: (teamALevel: number, teamBLevel: number) => void;
  setWinningTeam: (winningTeam: Team | null) => void;
  reset: () => void;
}

const initialState = {
  gameId: null,
  gameStatus: "waiting" as GameStatus,
  participants: [],
  myPlayerId: null,
  myPosition: null,
  hand: [],
  currentTrick: [],
  currentPlayerTurn: null,
  roundId: null as string | null,
  roundStatus: "in_progress" as RoundStatus,
  finishingPositions: null as number[] | null,
  pendingTributeChoice: null as GameRound["gameState"]["pendingTributeChoice"] | null,
  pendingGiverChoice: null as GameRound["gameState"]["pendingGiverChoice"] | null,
  roundActions: [] as GameAction[],
  teamLevels: [2, 2] as [number, number],
  winningTeam: null as Team | null,
};

export const useGameStore = create<GameStoreState>((set) => ({
  ...initialState,

  setGame: (gameId, myPlayerId) => set({ gameId, myPlayerId }),
  setGameStatus: (gameStatus) => set({ gameStatus }),
  setMyPosition: (myPosition) => set({ myPosition }),
  setHand: (hand) => set({ hand }),
  updateTrick: (currentTrick) => set({ currentTrick }),
  setCurrentPlayerTurn: (currentPlayerTurn) => set({ currentPlayerTurn }),
  applyRoundUpdate: (round) =>
    set((state) => ({
      roundId: round.id,
      roundStatus: round.status,
      currentTrick: round.gameState.currentTrick,
      currentPlayerTurn: round.currentPlayerTurn,
      finishingPositions: round.finishingPositions,
      pendingTributeChoice: round.gameState.pendingTributeChoice ?? null,
      pendingGiverChoice: round.gameState.pendingGiverChoice ?? null,
      // A fresh round (startNextRound's insert) starts its action history
      // over; the same round updating again (e.g. a status transition)
      // keeps whatever's already been recorded.
      roundActions: state.roundId !== null && state.roundId !== round.id ? [] : state.roundActions,
    })),
  appendRoundAction: (action) =>
    set((state) => ({ roundActions: [...state.roundActions, action] })),
  setRoundActions: (roundActions) => set({ roundActions }),
  updateParticipants: (participants) => set({ participants }),
  // Upserts by id rather than always appending, since a rejoin (e.g. after a
  // brief disconnect) broadcasts the same participant id again.
  addParticipant: (participant) =>
    set((state) => {
      const existingIndex = state.participants.findIndex((p) => p.id === participant.id);
      if (existingIndex === -1) {
        return { participants: [...state.participants, participant] };
      }
      const participants = [...state.participants];
      participants[existingIndex] = participant;
      return { participants };
    }),
  adjustHandCounts: (deltas) =>
    set((state) => {
      const byPosition = new Map(deltas.map((d) => [d.position, d.delta]));
      return {
        participants: state.participants.map((p) =>
          p.position !== null && byPosition.has(p.position)
            ? { ...p, handCount: p.handCount + byPosition.get(p.position)! }
            : p,
        ),
      };
    }),
  setTeamLevels: (teamALevel, teamBLevel) =>
    set({ teamLevels: [teamALevel, teamBLevel] }),
  setWinningTeam: (winningTeam) => set({ winningTeam }),
  reset: () => set(initialState),
}));

// ---------------------------------------------------------------------------
// Derived state (RULES.md: partners sit opposite each other, 0 & 2 vs 1 & 3)
// ---------------------------------------------------------------------------

// Not store-shaped (takes a plain participants array) so callers outside
// the store - e.g. game/[id]/page.tsx's WaitingRoom and in-progress board -
// can share the same spectator predicate instead of re-writing the
// `position === null` filter themselves.
export function filterSpectators(participants: GameParticipant[]): GameParticipant[] {
  return participants.filter((p) => p.position === null);
}

export function getSeatedParticipants(state: GameStoreState): GameParticipant[] {
  return state.participants.filter((p) => p.position !== null);
}

export function getSpectators(state: GameStoreState): GameParticipant[] {
  return filterSpectators(state.participants);
}

export function getMyTeam(state: GameStoreState): Team | null {
  return state.myPosition === null ? null : ((state.myPosition % 2) as Team);
}

export function getTeammatePosition(
  state: GameStoreState,
): PlayerPosition | null {
  return state.myPosition === null
    ? null
    : (((state.myPosition + 2) % 4) as PlayerPosition);
}

export function getIsMyTurn(state: GameStoreState): boolean {
  return (
    state.myPosition !== null &&
    state.currentPlayerTurn === state.myPosition
  );
}
