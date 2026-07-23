// Local client-side game state, kept in sync with the server via
// useGameRealtimeSync (Task 4.2). See ARCHITECTURE.md section 6 ("State
// Management") for the original sketch this refines against the concrete
// types in lib/types.ts.
import { create } from "zustand";
import type {
  CurrentTrick,
  GameParticipant,
  GameStatus,
  PlayerPosition,
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
  updateParticipants: (participants: GameParticipant[]) => void;
  addParticipant: (participant: GameParticipant) => void;
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
  setTeamLevels: (teamALevel, teamBLevel) =>
    set({ teamLevels: [teamALevel, teamBLevel] }),
  setWinningTeam: (winningTeam) => set({ winningTeam }),
  reset: () => set(initialState),
}));

// ---------------------------------------------------------------------------
// Derived state (RULES.md: partners sit opposite each other, 0 & 2 vs 1 & 3)
// ---------------------------------------------------------------------------

export function getSeatedParticipants(state: GameStoreState): GameParticipant[] {
  return state.participants.filter((p) => p.position !== null);
}

export function getSpectators(state: GameStoreState): GameParticipant[] {
  return state.participants.filter((p) => p.position === null);
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
