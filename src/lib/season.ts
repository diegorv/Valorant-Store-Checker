/**
 * Season labels
 *
 * HenrikDev identifies acts by a short code: "e8a2" (Episode 8, Act 2) for
 * the episode era, "v25a1" (2025, Act 1) since the game moved to yearly
 * seasons. Anything else is shown as-is.
 */

const EPISODE = /^e(\d+)a(\d+)$/i;
const YEARLY = /^v(\d{2})a(\d+)$/i;

export function formatSeasonShort(short: string): string {
  const episode = EPISODE.exec(short);
  if (episode) return `Episode ${Number(episode[1])} · Act ${Number(episode[2])}`;
  const yearly = YEARLY.exec(short);
  if (yearly) return `20${yearly[1]} · Act ${Number(yearly[2])}`;
  return short.toUpperCase();
}

/** Compact form for tight spots: "E8 A2", "2025 A1". */
export function formatSeasonCompact(short: string): string {
  const episode = EPISODE.exec(short);
  if (episode) return `E${Number(episode[1])} A${Number(episode[2])}`;
  const yearly = YEARLY.exec(short);
  if (yearly) return `20${yearly[1]} A${Number(yearly[2])}`;
  return short.toUpperCase();
}

/** Newest act first. Yearly codes come after every episode code. */
export function compareSeasonShortDesc(a: string, b: string): number {
  const key = (s: string): [number, number, number] => {
    const e = EPISODE.exec(s);
    if (e) return [0, Number(e[1]), Number(e[2])];
    const y = YEARLY.exec(s);
    if (y) return [1, Number(y[1]), Number(y[2])];
    return [-1, 0, 0];
  };
  const [ea, ma, na] = key(a);
  const [eb, mb, nb] = key(b);
  return eb - ea || mb - ma || nb - na;
}
