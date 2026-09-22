"use client";

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import { InventoryCard } from "./InventoryCard";
import { PdfDownloadButton } from "./PdfDownloadButton";
import type { CollectionSkin, EditionCategory } from "@/types/inventory";
import { getEditionIconPath } from "@/lib/edition-icons";
import { compareSkins, groupWeaponsByClass, COLLECTION_SORTS, type CollectionSort } from "@/lib/collection-sort";
import { columnsForWidth, GRID_GAP } from "@/lib/collection-layout";

interface InventoryGridProps {
  /** Skins in the player's entitlements */
  skins: CollectionSkin[];
  /** The rest of the catalog; empty when the page did not ask for it */
  unownedSkins?: CollectionSkin[];
  weaponCategories: string[];
  editionCategories: EditionCategory[];
}

type Ownership = "owned" | "unowned" | "all";

const OWNERSHIP_OPTIONS: { value: Ownership; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "unowned", label: "Not owned" },
  { value: "all", label: "All" },
];

export function InventoryGrid({ skins, unownedSkins = [], weaponCategories, editionCategories }: InventoryGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeWeapons, setActiveWeapons] = useState<string[]>([]);
  const [activeEditions, setActiveEditions] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<Ownership>("owned");
  const [sort, setSort] = useState<CollectionSort>("weapon");

  // Which side of the collection is on screen, in the chosen order. The
  // default follows the armory (sidearms → … → melee); in a mixed view owned
  // skins come first within each weapon, so the gaps sit next to what you have.
  const scopedSkins = useMemo(() => {
    const list =
      ownership === "owned" ? skins
      : ownership === "unowned" ? unownedSkins
      : [...skins, ...unownedSkins];
    return [...list].sort(compareSkins(sort));
  }, [ownership, sort, skins, unownedSkins]);

  // Weapon pills grouped the way the armory is, not alphabetically
  const weaponGroups = useMemo(() => groupWeaponsByClass(weaponCategories), [weaponCategories]);

  // Filter skins based on search query, weapon filter, and edition filter
  const filteredSkins = useMemo(() => {
    let result = scopedSkins;

    // Apply weapon filter
    if (activeWeapons.length > 0) {
      result = result.filter((skin) => activeWeapons.includes(skin.weaponName));
    }

    // Apply edition filter
    if (activeEditions.length > 0) {
      result = result.filter((skin) => skin.tierName && activeEditions.includes(skin.tierName));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((skin) =>
        skin.displayName.toLowerCase().includes(query)
      );
    }

    return result;
  }, [scopedSkins, activeWeapons, activeEditions, searchQuery]);

  // The PDF is "my collection": only what is owned, within the current filters
  const ownedInView = useMemo(() => filteredSkins.filter((skin) => skin.owned), [filteredSkins]);

  // The grid is virtualized by row, so the slice of skins per row must match
  // the columns the grid draws. Both come from the container's real width:
  // a phone gets one column, a desktop four. Rows are measured after they
  // render, since a card is taller when it has the whole width to itself.
  const hasResults = filteredSkins.length > 0;
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => setColumns(columnsForWidth(el.clientWidth));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasResults]);

  const rowCount = Math.ceil(filteredSkins.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 300,
    gap: GRID_GAP,
    overscan: 3,
  });
  // A different column count reshuffles every row, so cached heights are stale
  useEffect(() => {
    rowVirtualizer.measure();
  }, [columns, rowVirtualizer]);

  const toggleWeapon = (weapon: string) => {
    setActiveWeapons((prev) =>
      prev.includes(weapon)
        ? prev.filter((w) => w !== weapon)
        : [...prev, weapon]
    );
  };

  /** Class label click: select the whole class, or clear it if every weapon in it is already selected */
  const toggleWeaponClass = (weapons: readonly string[]) => {
    setActiveWeapons((prev) => {
      const allSelected = weapons.every((w) => prev.includes(w));
      const without = prev.filter((w) => !weapons.includes(w));
      return allSelected ? without : [...without, ...weapons];
    });
  };

  const toggleEdition = (edition: string) => {
    setActiveEditions((prev) =>
      prev.includes(edition)
        ? prev.filter((e) => e !== edition)
        : [...prev, edition]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setActiveWeapons([]);
    setActiveEditions([]);
  };

  const hasActiveFilters = activeWeapons.length > 0 || activeEditions.length > 0 || searchQuery.trim() !== "";

  return (
    <div className="space-y-6">
      {/* Search and Filter Controls */}
      <div className="space-y-4">
        {/* Search Input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search skins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-void-deep border border-white/10 angular-card text-light placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-all"
          />
        </div>

        {/* Ownership Filter Pills — only when the catalog side was loaded */}
        {unownedSkins.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Show</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Ownership">
              {OWNERSHIP_OPTIONS.map((option) => {
                const count =
                  option.value === "owned" ? skins.length
                  : option.value === "unowned" ? unownedSkins.length
                  : skins.length + unownedSkins.length;
                const isSelected = ownership === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setOwnership(option.value)}
                    aria-pressed={isSelected}
                    className={`px-4 py-2 text-sm font-semibold uppercase tracking-wide angular-card-sm transition-all flex items-center gap-2 ${
                      isSelected
                        ? "bg-brand text-void-deep"
                        : "bg-void-deep border border-white/10 text-zinc-400 hover:border-brand/50 hover:text-light"
                    }`}
                  >
                    {option.label}
                    <span className={`text-xs font-mono ${isSelected ? "text-void-deep/70" : "text-zinc-500"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sort */}
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sort by</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sort by">
            {COLLECTION_SORTS.map((option) => {
              const isSelected = sort === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setSort(option.value)}
                  aria-pressed={isSelected}
                  className={`px-4 py-2 text-sm font-semibold uppercase tracking-wide angular-card-sm transition-all ${
                    isSelected
                      ? "bg-brand text-void-deep"
                      : "bg-void-deep border border-white/10 text-zinc-400 hover:border-brand/50 hover:text-light"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Weapon Filter Pills — grouped by class, in armory order */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Weapon</span>
            {activeWeapons.length > 0 && (
              <button
                onClick={() => setActiveWeapons([])}
                className="text-xs text-brand hover:text-brand/80 uppercase tracking-wide font-semibold transition-colors"
              >
                All weapons
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 max-h-[170px] overflow-y-auto pr-2 custom-scrollbar">
            {weaponGroups.map((group) => {
              const classSelected = group.weapons.every((w) => activeWeapons.includes(w));
              return (
                <div key={group.name} className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => toggleWeaponClass(group.weapons)}
                    aria-pressed={classSelected}
                    title={classSelected ? `Clear ${group.name}` : `Select all ${group.name}`}
                    className={`text-[10px] font-display uppercase tracking-widest px-1.5 py-0.5 border-l-2 transition-colors ${
                      classSelected ? "border-brand text-brand" : "border-white/20 text-zinc-500 hover:text-brand hover:border-brand/60"
                    }`}
                  >
                    {group.name}
                  </button>
                  {group.weapons.map((weapon) => (
                    <button
                      key={weapon}
                      onClick={() => toggleWeapon(weapon)}
                      aria-pressed={activeWeapons.includes(weapon)}
                      className={`px-3 py-1.5 text-sm font-semibold uppercase tracking-wide angular-card-sm transition-all ${
                        activeWeapons.includes(weapon)
                          ? "bg-brand text-void-deep"
                          : "bg-void-deep border border-white/10 text-zinc-400 hover:border-brand/50 hover:text-light"
                      }`}
                    >
                      {weapon}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Edition Filter Pills */}
        {editionCategories.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Edition</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveEditions([])}
                className={`px-4 py-2 text-sm font-semibold uppercase tracking-wide angular-card-sm transition-all ${
                  activeEditions.length === 0
                    ? "bg-brand text-void-deep"
                    : "bg-void-deep border border-white/10 text-zinc-400 hover:border-brand/50 hover:text-light"
                }`}
              >
                All
              </button>
              {editionCategories.map((edition) => {
                const isSelected = activeEditions.includes(edition.name);
                return (
                  <button
                    key={edition.name}
                    onClick={() => toggleEdition(edition.name)}
                    className={`px-4 py-2 text-sm font-semibold uppercase tracking-wide angular-card-sm transition-all flex items-center gap-2 ${
                      isSelected
                        ? "text-white"
                        : "bg-void-deep border border-white/10 text-zinc-400 hover:text-light"
                    }`}
                    style={
                      isSelected
                        ? { backgroundColor: edition.color, borderColor: edition.color }
                        : { borderColor: undefined }
                    }
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = `${edition.color}80`;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "";
                      }
                    }}
                  >
                    {getEditionIconPath(edition.name) ? (
                      <Image
                        src={getEditionIconPath(edition.name)!}
                        alt=""
                        width={16}
                        height={16}
                        className="flex-shrink-0"
                      />
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: edition.color }}
                      />
                    )}
                    {edition.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Count Display */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            Showing <span className="text-light font-semibold">{filteredSkins.length}</span> of{" "}
            <span className="text-light font-semibold">{scopedSkins.length}</span>{" "}
            {ownership === "owned" ? "owned" : ownership === "unowned" ? "not owned" : ""} skins
          </p>
          <div className="flex items-center gap-3">
            {ownedInView.length > 0 && <PdfDownloadButton skins={ownedInView} />}
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-xs text-brand hover:text-brand/80 uppercase tracking-wide font-semibold transition-colors"
              >
                Clear All Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Virtualized Skins Grid */}
      {filteredSkins.length > 0 ? (
        <div
          ref={parentRef}
          className="h-[calc(100vh-300px)] overflow-y-auto"
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const startIdx = virtualRow.index * columns;
              const rowSkins = filteredSkins.slice(startIdx, startIdx + columns);
              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-testid="collection-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className="grid gap-6"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                  >
                    {rowSkins.map((skin) => (
                      <InventoryCard key={skin.uuid} skin={skin} showOwnedBadge={ownership === "all"} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <div className="text-zinc-500">
            <svg
              className="h-16 w-16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-center">
            No skins match your filters.
            <br />
            <button
              onClick={clearAllFilters}
              className="text-brand hover:underline mt-2"
            >
              Clear filters
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
