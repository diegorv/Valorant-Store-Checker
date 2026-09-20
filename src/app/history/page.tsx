"use client";

import { db } from "@/lib/db";
import { HistoryCard } from "@/components/history/HistoryCard";
import { HistoryStats } from "@/components/history/HistoryStats";
import { computeHistoryStats } from "@/lib/history-stats";
import type { StoreRotation, HistoryStats as HistoryStatsType } from "@/types/history";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, User } from "lucide-react";

/**
 * Before history lived on the server, each browser logged rotations into its
 * own IndexedDB. On the first visit after that change, whatever this browser
 * has is sent up once; the server ignores days it already knows.
 */
const IMPORT_FLAG = "vsc:history-imported";

async function importBrowserHistory(): Promise<void> {
  if (!db) return;
  try {
    if (window.localStorage.getItem(IMPORT_FLAG)) return;
  } catch {
    // storage blocked: try the import every time, it is idempotent
  }
  const rotations = await db.storeRotations.toArray();
  if (rotations.length > 0) {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rotations: rotations.map(({ id: _id, ...rotation }) => rotation),
      }),
    });
    if (!response.ok) return; // keep the flag unset so the next visit retries
  }
  try {
    window.localStorage.setItem(IMPORT_FLAG, "1");
  } catch {
    // ignore
  }
}

type LoadState = "loading" | "ready" | "unauthorized" | "error";

interface AccountGroup {
  puuid: string;
  displayName: string; // "GameName#Tag" or truncated puuid
  rotations: StoreRotation[];
  stats: HistoryStatsType;
}

// ─── Per-Account Section ──────────────────────────────────────────────────────

interface AccountSectionProps {
  group: AccountGroup;
  onDelete: (id: number) => void;
  defaultExpanded?: boolean;
}

function AccountSection({ group, onDelete, defaultExpanded = true }: AccountSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="angular-card bg-void-surface/40 overflow-hidden">
      {/* Section header — click to toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-void-surface/60 transition-colors duration-200 group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          {/* Avatar icon */}
          <div className="w-9 h-9 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-brand" />
          </div>

          <div className="text-left">
            <p className="font-display text-xl uppercase text-light tracking-wide">
              {group.displayName}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {group.rotations.length} rotation{group.rotations.length !== 1 ? "s" : ""} recorded
            </p>
          </div>
        </div>

        <ChevronDown
          size={18}
          className={`text-zinc-500 transition-transform duration-300 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="px-6 pb-6 space-y-5 border-t border-white/5">
          {/* Per-account stats */}
          <div className="pt-5">
            <HistoryStats stats={group.stats} />
          </div>

          {/* Angular separator */}
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* History cards */}
          <div className="space-y-4">
            {group.rotations.map((rotation, index) => (
              <HistoryCard
                key={rotation.id ?? rotation.date}
                rotation={rotation}
                staggerIndex={index}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [rotations, setRotations] = useState<StoreRotation[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (response.status === 401) {
      setState("unauthorized");
      return;
    }
    if (!response.ok) throw new Error(`History request failed: ${response.status}`);
    const data = (await response.json()) as { rotations: StoreRotation[] };
    setRotations(data.rotations);
    setState("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await importBrowserHistory().catch((error) => console.warn("History import skipped:", error));
        if (!cancelled) await load();
      } catch (error) {
        console.error("Failed to load history:", error);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Group rotations by puuid and compute per-account stats
  const accountGroups = useMemo((): AccountGroup[] => {
    if (rotations.length === 0) return [];

    const map = new Map<string, StoreRotation[]>();
    for (const rotation of rotations) {
      const group = map.get(rotation.puuid) ?? [];
      group.push(rotation);
      map.set(rotation.puuid, group);
    }

    return Array.from(map.entries()).map(([puuid, rots]) => {
      const first = rots[0];
      const displayName = first?.gameName
        ? `${first.gameName}${first.tagLine ? `#${first.tagLine}` : ""}`
        : `${puuid.slice(0, 8)}…`;

      return {
        puuid,
        displayName,
        rotations: rots, // already newest-first from the API
        stats: computeHistoryStats(rots),
      };
    });
  }, [rotations]);

  const handleDelete = useCallback(async (id: number) => {
    const response = await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (response.ok) setRotations((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (state === "unauthorized") {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto space-y-8">
          <h1 className="font-display text-5xl uppercase text-light mb-8">Store History</h1>
          <div className="angular-card bg-void-surface/50 p-12 text-center space-y-6">
            <p className="text-xl text-zinc-400">Sign in to see your store history</p>
            <p className="text-sm text-zinc-500">
              Every day you open your store is recorded to your account, on any device.
            </p>
            <Link
              href="/login"
              className="inline-block px-6 py-3 bg-brand hover:bg-brand/80 text-void-deep font-medium uppercase tracking-wide transition-colors duration-200 angular-btn"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto space-y-8">
          <h1 className="font-display text-5xl uppercase text-light mb-8">Store History</h1>
          <div className="angular-card bg-void-surface/50 p-12 text-center space-y-4">
            <p className="text-xl text-zinc-400">Could not load your history</p>
            <button
              onClick={() => { setState("loading"); load().catch(() => setState("error")); }}
              className="inline-block px-6 py-3 bg-brand hover:bg-brand/80 text-void-deep font-medium uppercase tracking-wide transition-colors duration-200 angular-btn"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto space-y-8">
          <h1 className="font-display text-5xl uppercase text-light mb-8">Store History</h1>
          <div className="angular-card bg-void-surface/50 p-12 text-center">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-void-deep/50 rounded w-1/3 mx-auto" />
              <div className="h-4 bg-void-deep/50 rounded w-1/2 mx-auto" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (rotations.length === 0) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto space-y-8">
          <h1 className="font-display text-5xl uppercase text-light mb-8">Store History</h1>
          <div className="angular-card bg-void-surface/50 p-12 text-center space-y-6">
            <p className="text-xl text-zinc-400">No store history yet</p>
            <p className="text-sm text-zinc-500">
              Visit your Store page to start tracking daily rotations.
            </p>
            <Link
              href="/store"
              className="inline-block px-6 py-3 bg-brand hover:bg-brand/80 text-void-deep font-medium uppercase tracking-wide transition-colors duration-200 angular-btn"
            >
              Go to Store
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Page title + account count badge */}
        <div className="flex items-end gap-4 mb-8">
          <h1 className="font-display text-5xl uppercase text-light">Store History</h1>
          {accountGroups.length > 1 && (
            <span className="mb-1.5 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider bg-brand/15 text-brand border border-brand/30 rounded">
              {accountGroups.length} accounts
            </span>
          )}
        </div>

        {/* One section per account */}
        <div className="space-y-6">
          {accountGroups.map((group, i) => (
            <AccountSection
              key={group.puuid}
              group={group}
              onDelete={handleDelete}
              defaultExpanded={i === 0}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
