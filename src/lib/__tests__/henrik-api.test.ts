/**
 * henrik-api.ts — the in-memory caches are capped.
 *
 * The TTL is only checked when the same player is read again, so without a cap
 * an entry for a player who never returns is never freed. Each cache keeps at
 * most MAX_CACHE_ENTRIES entries and evicts the oldest insertion first, like
 * the inventory cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mirrors MAX_CACHE_ENTRIES in henrik-api.ts.
const MAX_CACHE_ENTRIES = 50;

const ACCOUNT = {
  puuid: "puuid",
  region: "na",
  account_level: 42,
  name: "Player",
  tag: "NA1",
  card: { small: "s.png", large: "l.png", wide: "w.png", id: "card-1" },
  last_update: "now",
  last_update_raw: 0,
};

/** Answers every Henrik endpoint with a payload its parser accepts. */
const fetchMock = vi.fn(async (url: string) => {
  const data = url.includes("/stored-matches/") ? [] : url.includes("/mmr/") ? {} : ACCOUNT;
  return new Response(JSON.stringify({ data }), { status: 200 });
});

// Each test gets a fresh module instance so the module-level Maps start empty.
async function freshHenrikApi() {
  vi.resetModules();
  return await import("@/lib/henrik-api");
}

type HenrikApi = Awaited<ReturnType<typeof freshHenrikApi>>;

const caches: [string, (api: HenrikApi, puuid: string) => Promise<unknown>][] = [
  ["account", (api, puuid) => api.getHenrikAccount(puuid, "na")],
  ["MMR", (api, puuid) => api.getHenrikMMR(puuid, "na")],
  ["stored matches", (api, puuid) => api.getHenrikStoredMatches(puuid, "na")],
];

describe.each(caches)("%s cache eviction", (_name, load) => {
  beforeEach(() => {
    // Vitest 3+ mockReset restores the vi.fn() implementation and drops leftover *Once queues
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps at most MAX_CACHE_ENTRIES entries, evicting the oldest insertion", async () => {
    const api = await freshHenrikApi();

    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      await load(api, `puuid-${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES);

    // Still cached — no extra fetch
    await load(api, "puuid-0");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES);

    // One entry past the cap evicts the oldest insertion (puuid-0)
    await load(api, "puuid-overflow");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 1);

    await load(api, "puuid-0");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);

    // puuid-1 was the oldest left before puuid-0 came back, so it went next;
    // puuid-2 is still cached
    await load(api, "puuid-2");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);
  });

  it("does not evict when refreshing an existing key at capacity", async () => {
    vi.useFakeTimers();
    try {
      const api = await freshHenrikApi();

      for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
        await load(api, `puuid-${i}`);
      }

      // Past the TTL, a read refetches and re-sets puuid-10 in place
      vi.advanceTimersByTime(6 * 60 * 1000);
      await load(api, "puuid-10");
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 1);

      // A failed fetch falls back to the stale entry — present only if puuid-0 survived
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      expect(await load(api, "puuid-0")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
