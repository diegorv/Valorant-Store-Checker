/**
 * Collection ordering
 *
 * Weapon classes in the order the in-game armory shows them, plus the
 * comparators the Collection grid sorts with. Pure module, safe on the client.
 */

import type { CollectionSkin } from "@/types/inventory";

export interface WeaponClass {
  name: string;
  weapons: readonly string[];
}

/** Armory order. Every gun is listed; melee skins carry many names and fall into "Melee". */
export const WEAPON_CLASSES: readonly WeaponClass[] = [
  { name: "Sidearms", weapons: ["Classic", "Shorty", "Frenzy", "Ghost", "Sheriff"] },
  { name: "SMGs", weapons: ["Stinger", "Spectre"] },
  { name: "Shotguns", weapons: ["Bucky", "Judge"] },
  { name: "Rifles", weapons: ["Bulldog", "Guardian", "Phantom", "Vandal"] },
  { name: "Sniper Rifles", weapons: ["Marshal", "Outlaw", "Operator"] },
  { name: "Heavy", weapons: ["Ares", "Odin"] },
  { name: "Melee", weapons: ["Melee"] },
];

/** Skins the catalog could not identify (`weaponName: "Unknown"`) go last. */
export const OTHER_CLASS = "Other";
const UNKNOWN_WEAPON = "Unknown";

const MELEE_INDEX = WEAPON_CLASSES.findIndex((c) => c.name === "Melee");

const weaponIndex = new Map<string, { classIndex: number; order: number }>();
WEAPON_CLASSES.forEach((cls, classIndex) => {
  cls.weapons.forEach((weapon, order) => weaponIndex.set(weapon.toLowerCase(), { classIndex, order }));
});

/** Class a weapon name belongs to. Unlisted names are melee skins (knives, axes, …). */
export function weaponClassOf(weaponName: string): string {
  if (weaponName === UNKNOWN_WEAPON) return OTHER_CLASS;
  const known = weaponIndex.get(weaponName.toLowerCase());
  return known ? WEAPON_CLASSES[known.classIndex]!.name : "Melee";
}

/** Sort key: class first, then position within the class, unlisted melee names after "Melee" alphabetically. */
function weaponSortKey(weaponName: string): [number, number, string] {
  if (weaponName === UNKNOWN_WEAPON) return [WEAPON_CLASSES.length, 0, weaponName];
  const known = weaponIndex.get(weaponName.toLowerCase());
  if (known) return [known.classIndex, known.order, weaponName];
  return [MELEE_INDEX, 1, weaponName];
}

/** Orders weapon names the way the armory does. */
export function compareWeapons(a: string, b: string): number {
  const [ca, oa, na] = weaponSortKey(a);
  const [cb, ob, nb] = weaponSortKey(b);
  return ca - cb || oa - ob || na.localeCompare(nb);
}

/** Groups weapon names by class, classes and weapons both in armory order. Empty classes are dropped. */
export function groupWeaponsByClass(weapons: readonly string[]): WeaponClass[] {
  const buckets = new Map<string, string[]>();
  for (const weapon of weapons) {
    const cls = weaponClassOf(weapon);
    buckets.set(cls, [...(buckets.get(cls) ?? []), weapon]);
  }
  const order = [...WEAPON_CLASSES.map((c) => c.name), OTHER_CLASS];
  return order
    .filter((name) => buckets.has(name))
    .map((name) => ({ name, weapons: [...buckets.get(name)!].sort(compareWeapons) }));
}

/** Rarity, most exclusive first. Editions not listed sort after these. */
const EDITION_RANK: Record<string, number> = {
  "Ultra Edition": 0,
  "Exclusive Edition": 1,
  "Premium Edition": 2,
  "Deluxe Edition": 3,
  "Select Edition": 4,
};

function editionRank(tierName: string | null): number {
  return tierName ? (EDITION_RANK[tierName] ?? Object.keys(EDITION_RANK).length) : Object.keys(EDITION_RANK).length + 1;
}

export type CollectionSort = "weapon" | "name" | "edition";

export const COLLECTION_SORTS: { value: CollectionSort; label: string }[] = [
  { value: "weapon", label: "Weapon type" },
  { value: "name", label: "Name" },
  { value: "edition", label: "Edition" },
];

const byName = (a: CollectionSkin, b: CollectionSkin) => a.displayName.localeCompare(b.displayName);
/** Owned before not owned, so in a mixed view the gaps sit next to what you have. */
const ownedFirst = (a: CollectionSkin, b: CollectionSkin) => (a.owned === b.owned ? 0 : a.owned ? -1 : 1);

/** Comparator for the grid. Ties always end on the skin name so the order is stable. */
export function compareSkins(sort: CollectionSort): (a: CollectionSkin, b: CollectionSkin) => number {
  switch (sort) {
    case "name":
      return (a, b) => byName(a, b) || compareWeapons(a.weaponName, b.weaponName);
    case "edition":
      return (a, b) =>
        editionRank(a.tierName) - editionRank(b.tierName) ||
        compareWeapons(a.weaponName, b.weaponName) ||
        ownedFirst(a, b) ||
        byName(a, b);
    case "weapon":
    default:
      return (a, b) => compareWeapons(a.weaponName, b.weaponName) || ownedFirst(a, b) || byName(a, b);
  }
}
