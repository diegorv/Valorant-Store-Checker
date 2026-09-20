import Image from "next/image";
import type { RecentMatch, MatchResult } from "@/lib/match-stats";
import { agentIconUrl } from "./MatchStatsSummary";

interface RecentMatchesProps {
  matches?: RecentMatch[];
}

const RESULT_TEXT: Record<MatchResult, string> = { win: "Victory", loss: "Defeat", draw: "Draw" };
const RESULT_BORDER: Record<MatchResult, string> = {
  win: "border-l-emerald-500",
  loss: "border-l-red-500",
  draw: "border-l-zinc-500",
};
const RESULT_TEXT_CLASS: Record<MatchResult, string> = {
  win: "text-emerald-400",
  loss: "text-red-400",
  draw: "text-zinc-400",
};

/** "3 days ago", "2 hours ago" — falls back to the date when the runtime lacks RelativeTimeFormat. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < hour ? [Math.round(diffMs / minute), "minute"]
    : abs < day ? [Math.round(diffMs / hour), "hour"]
    : [Math.round(diffMs / day), "day"];
  try {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
  } catch {
    return new Date(then).toLocaleDateString();
  }
}

/** "7d", "3h", "12m", "now" — for the narrow layout, where the full form gets cut off. */
export function formatRelativeCompact(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const abs = Math.abs(now - then);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (abs < minute) return "now";
  if (abs < hour) return `${Math.round(abs / minute)}m`;
  if (abs < day) return `${Math.round(abs / hour)}h`;
  return `${Math.round(abs / day)}d`;
}

/** The last competitive matches, newest first. */
export function RecentMatches({ matches }: RecentMatchesProps) {
  if (!matches || matches.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="Recent competitive matches">
      <span className="text-xs uppercase tracking-wider text-zinc-400">Recent Matches</span>
      <ol className="space-y-1.5">
        {matches.map((m) => {
          const icon = agentIconUrl(m.agentId);
          return (
            <li
              key={m.id}
              className={`flex items-center gap-3 px-3 py-2 angular-card-sm bg-void-surface/50 border-l-2 ${RESULT_BORDER[m.result]}`}
              aria-label={`${RESULT_TEXT[m.result]} ${m.roundsWon} to ${m.roundsLost} on ${m.map} as ${m.agent}, ${m.kills} kills ${m.deaths} deaths ${m.assists} assists, ${m.headshotPct} percent headshots`}
            >
              {icon ? (
                <Image src={icon} alt="" width={36} height={36} className="h-9 w-9 object-cover angular-card-sm shrink-0" />
              ) : (
                <span className="h-9 w-9 bg-void-deep shrink-0" aria-hidden="true" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`font-display text-sm uppercase tracking-wider ${RESULT_TEXT_CLASS[m.result]}`}>
                    {RESULT_TEXT[m.result]}
                  </span>
                  <span className="font-display text-sm text-light tabular-nums">
                    {m.roundsWon}–{m.roundsLost}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 text-xs text-zinc-500">
                  <span className="truncate">{m.map} · {m.agent}</span>
                  <span aria-hidden="true">·</span>
                  {/* Short on phones so the time never gets cut off; full form from sm up */}
                  <time dateTime={m.startedAt} title={new Date(m.startedAt).toLocaleString()} className="shrink-0">
                    <span className="sm:hidden">{formatRelativeCompact(m.startedAt)}</span>
                    <span className="hidden sm:inline">{formatRelative(m.startedAt)}</span>
                  </time>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-display text-sm text-light tabular-nums">
                  {m.kills} / {m.deaths} / {m.assists}
                </div>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  HS {m.headshotPct}% · {m.damageDealt.toLocaleString()} dmg
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
