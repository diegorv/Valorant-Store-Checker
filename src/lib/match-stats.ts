/**
 * Recent competitive matches and the statistics derived from them.
 *
 * Pure module: turns Henrik stored-match entries into what the profile page
 * shows, and aggregates them. Safe to import on the client.
 */

import type { HenrikStoredMatch } from "@/lib/schemas/henrik";

export type MatchResult = "win" | "loss" | "draw";

/** One competitive match, as shown on the profile page. */
export interface RecentMatch {
  id: string;
  map: string;
  agent: string;
  /** Valorant-API agent UUID, for the portrait; null when Henrik did not send one */
  agentId: string | null;
  startedAt: string; // ISO date
  result: MatchResult;
  roundsWon: number;
  roundsLost: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Shots that hit (head + body + leg) and how many of them were headshots; kept raw so lists can be aggregated exactly */
  shotsHit: number;
  headshots: number;
  /** 0–100, headshots / shotsHit for this match */
  headshotPct: number;
  damageDealt: number;
  score: number;
}

export interface AgentSummary {
  name: string;
  agentId: string | null;
  games: number;
  wins: number;
  /** 0–100 */
  winRate: number;
}

export interface MatchStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** 0–100, draws excluded from the denominator */
  winRate: number;
  /** kills / deaths, deaths floored at 1 */
  kd: number;
  /** (kills + assists) / deaths, deaths floored at 1 */
  kda: number;
  /** 0–100, total headshots over total shots that hit across the matches (not an average of per-match percentages) */
  headshotPct: number;
  avgDamage: number;
  avgScore: number;
  /** Newest first, one letter per match */
  form: MatchResult[];
  /** Most played agents, ties broken by win rate */
  topAgents: AgentSummary[];
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Henrik's `stats.team` is "Red"/"Blue"; the score object is keyed lowercase. */
function resultOf(match: HenrikStoredMatch): MatchResult | null {
  const team = match.stats.team.toLowerCase();
  const own = team === "red" ? match.teams.red : team === "blue" ? match.teams.blue : null;
  const other = team === "red" ? match.teams.blue : team === "blue" ? match.teams.red : null;
  if (own === null || own === undefined || other === null || other === undefined) return null;
  if (own === other) return "draw";
  return own > other ? "win" : "loss";
}

/** Shapes a stored match for display. Returns null for entries whose result cannot be read. */
export function toRecentMatch(match: HenrikStoredMatch): RecentMatch | null {
  const result = resultOf(match);
  if (result === null) return null;
  const team = match.stats.team.toLowerCase();
  const own = (team === "red" ? match.teams.red : match.teams.blue) ?? 0;
  const other = (team === "red" ? match.teams.blue : match.teams.red) ?? 0;
  const { head, body, leg } = match.stats.shots;
  return {
    id: match.meta.id,
    map: match.meta.map.name,
    agent: match.stats.character.name,
    agentId: match.stats.character.id ?? null,
    startedAt: match.meta.started_at,
    result,
    roundsWon: own,
    roundsLost: other,
    kills: match.stats.kills,
    deaths: match.stats.deaths,
    assists: match.stats.assists,
    shotsHit: head + body + leg,
    headshots: head,
    headshotPct: pct(head, head + body + leg),
    damageDealt: match.stats.damage.dealt,
    score: match.stats.score,
  };
}

/** Newest first. */
export function toRecentMatches(matches: HenrikStoredMatch[]): RecentMatch[] {
  return matches
    .flatMap((m) => {
      const shaped = toRecentMatch(m);
      return shaped ? [shaped] : [];
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Aggregates the matches given (call with the newest-first list). Null when there is nothing to aggregate. */
export function aggregateMatchStats(matches: RecentMatch[], topAgentCount = 3): MatchStats | null {
  if (matches.length === 0) return null;

  let wins = 0, losses = 0, draws = 0;
  let kills = 0, deaths = 0, assists = 0, damage = 0, score = 0;
  let shotsHit = 0, headshots = 0;
  const byAgent = new Map<string, AgentSummary>();

  for (const m of matches) {
    if (m.result === "win") wins++;
    else if (m.result === "loss") losses++;
    else draws++;
    kills += m.kills; deaths += m.deaths; assists += m.assists;
    damage += m.damageDealt; score += m.score;
    shotsHit += m.shotsHit; headshots += m.headshots;

    const agent = byAgent.get(m.agent) ?? { name: m.agent, agentId: m.agentId, games: 0, wins: 0, winRate: 0 };
    agent.games++;
    if (m.result === "win") agent.wins++;
    byAgent.set(m.agent, agent);
  }

  const decided = wins + losses;
  const safeDeaths = Math.max(1, deaths);
  const topAgents = [...byAgent.values()]
    .map((a) => ({ ...a, winRate: pct(a.wins, a.games) }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.name.localeCompare(b.name))
    .slice(0, topAgentCount);

  return {
    games: matches.length,
    wins, losses, draws,
    winRate: pct(wins, decided),
    kd: Math.round((kills / safeDeaths) * 100) / 100,
    kda: Math.round(((kills + assists) / safeDeaths) * 100) / 100,
    headshotPct: pct(headshots, shotsHit),
    avgDamage: Math.round(damage / matches.length),
    avgScore: Math.round(score / matches.length),
    form: matches.map((m) => m.result),
    topAgents,
  };
}
