import { describe, it, expect, vi } from "vitest";
import { importLegacyRotations, IMPORT_BATCH_SIZE } from "@/lib/history-import";
import type { StoreRotation } from "@/types/history";

function rotation(puuid: string, day: number, id?: number): StoreRotation {
  return {
    id,
    puuid,
    date: new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10),
    timestamp: 1,
    expiresAt: 2,
    items: [{ uuid: "a", displayName: "A", cost: 1775, tierName: null, tierColor: "#fff" }],
  };
}

describe("importLegacyRotations", () => {
  it("sends every pending rotation without its local id and returns the imported accounts", async () => {
    const post = vi.fn().mockResolvedValue({ skippedPuuids: [] });

    const done = await importLegacyRotations([rotation("a", 0, 1), rotation("b", 0, 2)], new Set(), post);

    expect(post).toHaveBeenCalledTimes(2); // one account at a time
    expect(post.mock.calls.flatMap(([batch]) => batch)).toEqual([
      expect.not.objectContaining({ id: expect.anything() }),
      expect.not.objectContaining({ id: expect.anything() }),
    ]);
    expect(done).toEqual(["a", "b"]);
  });

  it("does not send accounts already imported", async () => {
    const post = vi.fn().mockResolvedValue({ skippedPuuids: [] });

    const done = await importLegacyRotations([rotation("a", 0), rotation("b", 0)], new Set(["a"]), post);

    expect(post.mock.calls[0]![0].map((r: StoreRotation) => r.puuid)).toEqual(["b"]);
    expect(done).toEqual(["b"]);
  });

  it("leaves accounts the server skipped out, so a later visit retries them", async () => {
    const post = vi.fn().mockResolvedValue({ skippedPuuids: ["b"] });

    const done = await importLegacyRotations([rotation("a", 0), rotation("b", 0)], new Set(), post);

    expect(done).toEqual(["a"]);
  });

  it("splits one account's log into batches of IMPORT_BATCH_SIZE", async () => {
    const rotations = Array.from({ length: IMPORT_BATCH_SIZE + 5 }, (_, day) => rotation("a", day));
    const post = vi.fn().mockResolvedValue({ skippedPuuids: [] });

    const done = await importLegacyRotations(rotations, new Set(), post);

    expect(post.mock.calls.map(([batch]) => batch.length)).toEqual([IMPORT_BATCH_SIZE, 5]);
    expect(done).toEqual(["a"]);
  });

  it("never mixes two accounts in one batch", async () => {
    const post = vi.fn().mockResolvedValue({ skippedPuuids: [] });

    await importLegacyRotations([rotation("a", 0), rotation("b", 1), rotation("a", 2)], new Set(), post);

    expect(post.mock.calls.map(([batch]) => batch.map((r: StoreRotation) => r.puuid))).toEqual([
      ["a", "a"],
      ["b"],
    ]);
  });

  it("keeps importing the other accounts when one account's batch fails", async () => {
    const post = vi.fn().mockImplementation((batch: StoreRotation[]) =>
      Promise.resolve(batch[0]!.puuid === "a" ? null : { skippedPuuids: [] })
    );

    const done = await importLegacyRotations([rotation("a", 0), rotation("b", 0)], new Set(), post);

    expect(done).toEqual(["b"]); // "a" is retried on a later visit
  });

  it("stops sending an account after one of its batches fails", async () => {
    const rotations = Array.from({ length: IMPORT_BATCH_SIZE + 1 }, (_, day) => rotation("a", day));
    const post = vi.fn().mockResolvedValue(null);

    expect(await importLegacyRotations(rotations, new Set(), post)).toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when every account is already imported", async () => {
    const post = vi.fn();

    expect(await importLegacyRotations([rotation("a", 0)], new Set(["a"]), post)).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });
});
