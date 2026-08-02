import { teamForPosition, teamTextClass } from "@/lib/format";

// A player's name colored by team (blue for Team A, orange for Team B) —
// shared by GameHistory and RoundEndSummary, anywhere a name is shown
// alongside other players' names and the team split matters at a glance.
// `position` is null for a spectator or an unresolvable player, in which
// case the name renders uncolored since there's no team to show.
export default function TeamName({ name, position }: { name: string; position: number | null }) {
  if (position === null) return <>{name}</>;
  return <span className={teamTextClass(teamForPosition(position))}>{name}</span>;
}
