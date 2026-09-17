import { describe, it, expect } from "vitest";
import { toHenrikRegion, determineRegion } from "../region-utils";
import { UserInfo } from "../riot-auth";

// Minimal UserInfo fixture factory — only fields required for region tests
function makeUserInfo(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    sub: "test-puuid",
    country: "US",
    ...overrides,
  } as UserInfo;
}

describe("toHenrikRegion", () => {
  it.each([
    ["na", "na"],
    ["eu", "eu"],
    ["ap", "ap"],
    ["kr", "kr"],
    // Henrik has no latam/br endpoints — both collapse onto na.
    ["latam", "na"],
    ["br", "na"],
  ])("maps the supported region %s to %s", (input, expected) => {
    expect(toHenrikRegion(input)).toBe(expected);
  });

  it.each([
    ["ind", "ap"],
    ["as", "ap"],
    ["oce", "ap"],
    ["jp", "ap"],
    ["ru", "eu"],
    ["tr", "eu"],
  ])("maps the legacy Riot shard %s to %s", (input, expected) => {
    expect(toHenrikRegion(input)).toBe(expected);
  });

  it.each(["NA", "Eu", "LATAM", "IND", "Ru"])(
    "is case-insensitive for %s",
    (input) => {
      expect(toHenrikRegion(input)).toBe(toHenrikRegion(input.toLowerCase()));
    },
  );

  it.each(["", "atlantis", "na-1", "eu "])(
    "falls back to na for the unsupported region %j",
    (input) => {
      expect(toHenrikRegion(input)).toBe("na");
    },
  );

  it("prefers the direct mapping over the legacy table for regions in both", () => {
    // 'jp' is only in the legacy table, 'ap' only in the direct one — neither
    // shadows the other, but the direct table must win if that ever changes.
    expect(toHenrikRegion("ap")).toBe("ap");
    expect(toHenrikRegion("jp")).toBe("ap");
  });
});

describe("determineRegion — affinity", () => {
  it("prefers affinity.pp over affinity.live", () => {
    const userInfo = makeUserInfo({
      affinity: { pp: "eu", live: "na" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("eu");
  });

  it("falls back to affinity.live when pp is absent", () => {
    const userInfo = makeUserInfo({
      affinity: { live: "kr" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("kr");
  });

  it("falls back to the first affinity value when neither pp nor live is present", () => {
    const userInfo = makeUserInfo({
      affinity: { other: "ap" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("ap");
  });

  it("ignores an empty-string pp and uses live instead", () => {
    const userInfo = makeUserInfo({
      affinity: { pp: "", live: "br" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("br");
  });

  it("falls through to the country mapping when affinity holds no usable shard", () => {
    const userInfo = makeUserInfo({
      country: "GB",
      affinity: { pp: "" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("eu");
  });

  it("falls through to the country mapping when affinity is an empty object", () => {
    const userInfo = makeUserInfo({
      country: "JP",
      affinity: {},
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("ap");
  });

  it("takes affinity over country when both are present", () => {
    const userInfo = makeUserInfo({
      country: "US",
      affinity: { pp: "eu" },
    } as Partial<UserInfo>);
    expect(determineRegion(userInfo)).toBe("eu");
  });
});

describe("determineRegion — country fallback", () => {
  it("normalizes a lowercase country code", () => {
    expect(determineRegion(makeUserInfo({ country: "de" }))).toBe("eu");
  });

  it("defaults to na for an unknown country code", () => {
    expect(determineRegion(makeUserInfo({ country: "ZZ" }))).toBe("na");
  });

  it("defaults to na when country is undefined", () => {
    expect(determineRegion(makeUserInfo({ country: undefined }))).toBe("na");
  });

  it("defaults to na when country is null", () => {
    expect(determineRegion(makeUserInfo({ country: null }))).toBe("na");
  });

  it("defaults to na when country is an empty string", () => {
    expect(determineRegion(makeUserInfo({ country: "" }))).toBe("na");
  });

  // The full COUNTRY_TO_REGION contract, written out independently of the table
  // in the source. A wrong entry here routes a player at the wrong game shard,
  // so each code is asserted rather than sampled.
  //
  // Note: the six codes that map to "na" (US/USA/CA/CAN/MX/MEX) cannot be
  // distinguished from the unknown-country fallback, which also returns "na".
  it.each([
    // North America
    ["US", "na"],
    ["USA", "na"],
    ["CA", "na"],
    ["CAN", "na"],
    ["MX", "na"],
    ["MEX", "na"],

    // Europe
    ["GB", "eu"],
    ["GBR", "eu"],
    ["DE", "eu"],
    ["DEU", "eu"],
    ["FR", "eu"],
    ["FRA", "eu"],
    ["IT", "eu"],
    ["ITA", "eu"],
    ["ES", "eu"],
    ["ESP", "eu"],
    ["RU", "eu"],
    ["RUS", "eu"],
    ["TR", "eu"],
    ["TUR", "eu"],
    ["PL", "eu"],
    ["POL", "eu"],
    ["NL", "eu"],
    ["NLD", "eu"],
    ["SE", "eu"],
    ["SWE", "eu"],
    ["NO", "eu"],
    ["NOR", "eu"],
    ["DK", "eu"],
    ["DNK", "eu"],
    ["FI", "eu"],
    ["FIN", "eu"],
    ["UA", "eu"],
    ["UKR", "eu"],

    // Asia Pacific
    ["JP", "ap"],
    ["JPN", "ap"],
    ["KR", "kr"],
    ["KOR", "kr"],
    ["CN", "ap"],
    ["CHN", "ap"],
    ["TW", "ap"],
    ["TWN", "ap"],
    ["HK", "ap"],
    ["HKG", "ap"],
    ["SG", "ap"],
    ["SGP", "ap"],
    ["TH", "ap"],
    ["THA", "ap"],
    ["VN", "ap"],
    ["VNM", "ap"],
    ["ID", "ap"],
    ["IDN", "ap"],
    ["MY", "ap"],
    ["MYS", "ap"],
    ["PH", "ap"],
    ["PHL", "ap"],
    ["IN", "ap"],
    ["IND", "ap"],
    ["AU", "ap"],
    ["AUS", "ap"],
    ["NZ", "ap"],
    ["NZL", "ap"],

    // Latin America
    ["BR", "br"],
    ["BRA", "br"],
    ["AR", "latam"],
    ["ARG", "latam"],
    ["CL", "latam"],
    ["CHL", "latam"],
    ["CO", "latam"],
    ["COL", "latam"],
    ["PE", "latam"],
    ["PER", "latam"],
  ])("maps country %s to region %s", (country, expected) => {
    expect(determineRegion(makeUserInfo({ country }))).toBe(expected);
  });
});
