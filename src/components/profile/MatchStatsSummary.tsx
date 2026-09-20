import Image from "next/image";
import type { MatchStats, MatchResult } from "@/lib/match-stats";

interface MatchStatsSummaryProps {
  stats?: MatchStats;
}

const RESULT_LETTER: Record<MatchResult, string> = { win: "W", loss: "L", draw: "D" };
const RESULT_CLASS: Record<MatchResult, string> = {
  win: "bg-emerald-500/80 text-void-deep",
  loss: "bg-red-500/70 text-white",
  draw: "bg-zinc-500/60 text-white",
};

/** Agent portraits come straight from Valorant-API's predictable media URLs. */
export function agentIconUrl(agentId: string | null): string | null {
  return agentId ? `https://media.valorant-api.com/agents/${agentId}/displayicon.png` : null;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="angular-card-sm bg-void-surface/50 px-4 py-3">
      <span className="block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-display text-2xl text-light leading-tight">{value}</span>
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

/**
 * Statistics over the recent competitive matches: win rate, K/D, headshot %,
 * average damage, the last results as a strip, and the most played agents.
 */
export function MatchStatsSummary({ stats }: MatchStatsSummaryProps) {
  if (!stats || stats.games === 0) return null;

  return (
    <section className="space-y-3" aria-label="Recent competitive stats">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Last {stats.games} competitive</span>
        <span className="text-xs text-zinc-500">
          {stats.wins}W {stats.losses}L{stats.draws > 0 ? ` ${stats.draws}D` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Win rate" value={`${stats.winRate}%`} />
        <Tile label="K/D" value={stats.kd.toFixed(2)} hint={`KDA ${stats.kda.toFixed(2)}`} />
        <Tile label="Headshot" value={`${stats.headshotPct}%`} />
        <Tile label="Avg damage" value={stats.avgDamage.toLocaleString()} hint={`score ${stats.avgScore.toLocaleString()}`} />
      </div>

      {/* Form strip, newest first */}
      <ol className="flex gap-1" aria-label="Recent form, newest first">
        {stats.form.map((result, i) => (
          <li
            key={i}
            className={`w-6 h-6 flex items-center justify-center text-[11px] font-display font-bold angular-card-sm ${RESULT_CLASS[result]}`}
            aria-label={result}
          >
            {RESULT_LETTER[result]}
          </li>
        ))}
      </ol>

      {stats.topAgents.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Most played agents">
          {stats.topAgents.map((agent) => {
            const icon = agentIconUrl(agent.agentId);
            return (
              <li
                key={agent.name}
                className="flex items-center gap-2 pr-3 angular-card-sm bg-void-surface/50 overflow-hidden"
                aria-label={`${agent.name}: ${agent.games} ${agent.games === 1 ? "game" : "games"}, ${agent.winRate} percent win rate`}
              >
                {icon ? (
                  <Image src={icon} alt="" width={32} height={32} className="h-8 w-8 object-cover" />
                ) : (
                  <span className="h-8 w-8 bg-void-deep" aria-hidden="true" />
                )}
                <span className="font-display text-sm text-light">{agent.name}</span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {agent.games}× · {agent.winRate}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
