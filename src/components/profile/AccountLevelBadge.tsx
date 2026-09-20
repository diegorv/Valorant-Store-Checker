interface AccountLevelBadgeProps {
  /** From the Riot loadout; 0 when the player hides their level in game */
  accountLevel?: number;
  /** From HenrikDev, which still knows the level when it is hidden in game */
  henrikAccountLevel?: number;
  hideAccountLevel?: boolean;
}

/**
 * Picks the level to show: the first positive value, Riot first. A player who
 * hides their level in game gets 0 from Riot, so Henrik's value fills in.
 */
export function resolveAccountLevel(accountLevel?: number, henrikAccountLevel?: number): { level?: number; source: "riot" | "henrik" | "none" } {
  if (accountLevel !== undefined && accountLevel > 0) return { level: accountLevel, source: "riot" };
  if (henrikAccountLevel !== undefined && henrikAccountLevel > 0) return { level: henrikAccountLevel, source: "henrik" };
  return { level: accountLevel ?? henrikAccountLevel, source: "none" };
}

export function AccountLevelBadge({
  accountLevel,
  henrikAccountLevel,
  hideAccountLevel,
}: AccountLevelBadgeProps) {
  const { level, source } = resolveAccountLevel(accountLevel, henrikAccountLevel);

  if (level === undefined) {
    return (
      <div className="angular-card-sm bg-void-surface/30 p-4">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Account Level</span>
        <p className="font-display text-sm text-zinc-600 mt-1">Unavailable</p>
      </div>
    );
  }

  const hiddenInGame = hideAccountLevel || (accountLevel === 0 && source === "henrik");

  return (
    <div className="angular-card-sm bg-void-surface/50 p-4 space-y-2 hover:bg-void-surface/70 transition-colors duration-200">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Account Level</span>
        {hiddenInGame && (
          <span
            className="text-[10px] uppercase tracking-wider text-zinc-600 border border-zinc-700 px-1"
            title={source === "henrik" ? "Hidden in game; value from HenrikDev" : "Hidden in game"}
          >
            Hidden in game
          </span>
        )}
      </div>
      <p className="font-display text-2xl text-light">
        {level > 0 ? level : <span className="text-zinc-600 text-base">—</span>}
      </p>
    </div>
  );
}
