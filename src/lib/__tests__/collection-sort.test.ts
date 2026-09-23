import { describe, it, expect } from "vitest";
import {
  weaponClassOf,
  compareWeapons,
  groupWeaponsByClass,
  compareSkins,
} from "@/lib/collection-sort";
import type { CollectionSkin } from "@/types/inventory";

function skin(overrides: Partial<CollectionSkin>): CollectionSkin {
  return {
    uuid: overrides.displayName ?? "x",
    displayName: "Skin",
    owned: true,
    displayIcon: "",
    streamedVideo: null,
    wallpaper: null,
    blurDataURL: "",
    tierUuid: null,
    tierName: null,
    tierColor: "#000",
    chromaCount: 0,
    levelCount: 1,
    assetPath: "",
    weaponName: "Vandal",
    ...overrides,
  };
}

describe("weaponClassOf", () => {
  it("maps every gun to its armory class", () => {
    expect(weaponClassOf("Classic")).toBe("Sidearms");
    expect(weaponClassOf("Bandit")).toBe("Sidearms");
    expect(weaponClassOf("Spectre")).toBe("SMGs");
    expect(weaponClassOf("Judge")).toBe("Shotguns");
    expect(weaponClassOf("Vandal")).toBe("Rifles");
    expect(weaponClassOf("Outlaw")).toBe("Sniper Rifles");
    expect(weaponClassOf("Odin")).toBe("Heavy");
  });

  it("treats unlisted names as melee and the catalog fallback as Other", () => {
    expect(weaponClassOf("Melee")).toBe("Melee");
    expect(weaponClassOf("Karambit")).toBe("Melee");
    expect(weaponClassOf("Unknown")).toBe("Other");
  });
});

describe("compareWeapons", () => {
  it("orders by class, then armory position, not alphabetically", () => {
    const sorted = ["Vandal", "Odin", "Classic", "Karambit", "Operator", "Ghost", "Melee", "Unknown", "Bucky"].sort(compareWeapons);
    expect(sorted).toEqual(["Classic", "Ghost", "Bucky", "Vandal", "Operator", "Odin", "Melee", "Karambit", "Unknown"]);
  });
});

describe("groupWeaponsByClass", () => {
  it("groups in armory order and drops empty classes", () => {
    expect(groupWeaponsByClass(["Vandal", "Sheriff", "Phantom", "Classic", "Melee"])).toEqual([
      { name: "Sidearms", weapons: ["Classic", "Sheriff"] },
      { name: "Rifles", weapons: ["Phantom", "Vandal"] },
      { name: "Melee", weapons: ["Melee"] },
    ]);
  });
});

describe("compareSkins", () => {
  const skins = [
    skin({ displayName: "Reaver Vandal", weaponName: "Vandal", tierName: "Premium Edition", owned: false }),
    skin({ displayName: "Prime Vandal", weaponName: "Vandal", tierName: "Premium Edition", owned: true }),
    skin({ displayName: "Champions Classic", weaponName: "Classic", tierName: "Exclusive Edition", owned: false }),
    skin({ displayName: "Aerosol Odin", weaponName: "Odin", tierName: "Select Edition", owned: true }),
  ];
  const names = (sort: Parameters<typeof compareSkins>[0]) => [...skins].sort(compareSkins(sort)).map((s) => s.displayName);

  it("weapon: armory order, owned first within a weapon, then name", () => {
    expect(names("weapon")).toEqual(["Champions Classic", "Prime Vandal", "Reaver Vandal", "Aerosol Odin"]);
  });

  it("name: alphabetical regardless of weapon or ownership", () => {
    expect(names("name")).toEqual(["Aerosol Odin", "Champions Classic", "Prime Vandal", "Reaver Vandal"]);
  });

  it("edition: most exclusive first, then weapon order", () => {
    expect(names("edition")).toEqual(["Champions Classic", "Prime Vandal", "Reaver Vandal", "Aerosol Odin"]);
  });
});
