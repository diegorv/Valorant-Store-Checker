import Image from "next/image";
import { formatSeasonShort } from "@/lib/season";

interface RankDisplayProps {
  competitiveTierName?: string;
  competitiveTierIcon?: string;
  peakTierName?: string;
  /** Act the peak was reached in, Henrik short code (e.g. "e8a2") */
  peakSeason?: string;
  /** Placement games still needed before a rank is assigned */
  gamesNeededForRating?: number;
  /** Immortal+ leaderboard position, when placed */
  leaderboardRank?: number;
  henrikFailed?: boolean;
}

export function RankDisplay({
  competitiveTierName,
  competitiveTierIcon,
  peakTierName,
  peakSeason,
  gamesNeededForRating,
  leaderboardRank,
  henrikFailed,
}: RankDisplayProps) {
  if (competitiveTierName === undefined) {
    return (
      <div className="angular-card-sm bg-void-surface/30 p-4 text-center space-y-1">
        <p className="text-zinc-500 text-xs uppercase tracking-wider font-display">
          {henrikFailed ? "Rank unavailable" : "Unrated"}
        </p>
        {!henrikFailed && gamesNeededForRating !== undefined && gamesNeededForRating > 0 && (
          <p className="text-zinc-400 text-sm">
            {gamesNeededForRating} placement {gamesNeededForRating === 1 ? "game" : "games"} to go
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Current Rank card */}
      <div className="angular-card-sm bg-void-surface/50 p-4 space-y-2 hover:bg-void-surface/70 transition-colors duration-200">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Current Rank</span>
        <div className="flex items-center gap-3">
          {competitiveTierIcon && (
            <Image src={competitiveTierIcon} alt={competitiveTierName} width={40} height={40} className="object-contain" />
          )}
          <p className="font-display text-xl text-light">{competitiveTierName}</p>
        </div>
        {leaderboardRank !== undefined && (
          <p className="text-xs text-zinc-400">
            Leaderboard <span className="font-display text-brand">#{leaderboardRank.toLocaleString()}</span>
          </p>
        )}
      </div>

      {/* Peak Rank card — text only, no img (highest_rank.images unreliable in v2) */}
      <div className="angular-card-sm bg-void-surface/50 p-4 space-y-2 hover:bg-void-surface/70 transition-colors duration-200">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Peak Rank</span>
        <p className="font-display text-xl text-light">
          {peakTierName ?? <span className="text-zinc-600 text-sm">Unknown</span>}
        </p>
        {peakTierName && peakSeason && (
          <p className="text-xs text-zinc-400">{formatSeasonShort(peakSeason)}</p>
        )}
      </div>
    </div>
  );
}
