import type { ActRecord } from "@/lib/profile-cache";
import { formatSeasonCompact, formatSeasonShort } from "@/lib/season";

interface ActHistoryProps {
  acts?: ActRecord[];
  /** How many acts to show, newest first */
  limit?: number;
}

/**
 * Competitive history per act: rank at the end of the act, games played and
 * win rate. Data comes from Henrik `seasonal[]`, already newest first.
 */
export function ActHistory({ acts, limit = 6 }: ActHistoryProps) {
  if (!acts || acts.length === 0) return null;

  const shown = acts.slice(0, limit);

  return (
    <section className="space-y-2" aria-label="Competitive history by act">
      <span className="text-xs uppercase tracking-wider text-zinc-400">Act History</span>
      <ol className="divide-y divide-white/5 angular-card-sm bg-void-surface/50">
        {shown.map((act) => {
          const winRate = Math.round((act.wins / act.games) * 100);
          return (
            <li
              key={act.season}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
              aria-label={`${formatSeasonShort(act.season)}: ${act.endTierName ?? "no rank"}, ${act.wins} wins in ${act.games} games, ${winRate} percent`}
            >
              <span className="font-display uppercase tracking-wider text-zinc-400 w-20 shrink-0" title={formatSeasonShort(act.season)}>
                {formatSeasonCompact(act.season)}
              </span>
              <span className="font-display text-light flex-1 truncate">
                {act.endTierName ?? <span className="text-zinc-600">No rank</span>}
              </span>
              <span className="text-zinc-400 tabular-nums shrink-0">
                <span className="text-light">{act.wins}</span>
                <span className="text-zinc-600"> / </span>
                {act.games}
              </span>
              <span
                className={`font-display tabular-nums w-12 text-right shrink-0 ${winRate >= 50 ? "text-emerald-400" : "text-zinc-400"}`}
              >
                {winRate}%
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
