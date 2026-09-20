import { test, expect } from "playwright/test";

test.describe("Collection Page", () => {
  test("authenticated user opening the collection sees owned skins hydrated from mock entitlements", async ({ page }) => {
    // Login first
    await page.goto("/login");
    const mockAuthUrl = "https://playvalorant.com/opt_in#access_token=mock_access_token&id_token=mock_id_token";
    await page.getByLabel("Paste URL or Cookies").fill(mockAuthUrl);
    await page.getByRole("button", { name: "Complete Login" }).click();

    await expect(page).toHaveURL(/\/store/, { timeout: 10000 });

    // Reach the collection the way a user does, through the header nav
    await page.getByRole("link", { name: "Collection" }).first().click();
    await expect(page).toHaveURL(/\/inventory/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "My Collection" })).toBeVisible({ timeout: 15000 });

    // The owned count comes from the PD entitlements handler (2 level UUIDs),
    // the total from the catalog handler (3 skins). An empty collection also
    // renders the page happily, so assert the real numbers.
    await expect(page.getByRole("group", { name: "2 of 3 skins owned, 67 percent" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Showing 2 of 2 owned skins")).toBeVisible({ timeout: 15000 });

    // Each card's accessible name is "<skin>, <tier> tier, <weapon>". The tier
    // and the weapon are not in the entitlements payload — they only exist once
    // the level UUIDs are resolved against the Valorant-API handlers, so these
    // labels prove the hydration path ran rather than a fallback entry.
    await expect(page.getByRole("article", { name: "Prime Vandal, Select tier, Vandal" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("article", { name: "Reaver Omega, Select tier, Omega" })).toBeVisible({ timeout: 15000 });

    // The catalog skin outside the entitlements is not in the default view…
    await expect(page.getByRole("article", { name: /Oni Phantom/ })).toHaveCount(0);

    // …and shows up, labelled as such, under "Not owned"
    await page.getByRole("button", { name: "Not owned 1" }).click();
    await expect(page.getByText("Showing 1 of 1 not owned skins")).toBeVisible();
    await expect(page.getByRole("article", { name: "Oni Phantom, Select tier, Phantom, not owned" })).toBeVisible();

    // "All" mixes both, in armory order: sidearms → … → rifles (Phantom before
    // Vandal) → … → melee, with unknown weapons ("Omega") after melee
    await page.getByRole("button", { name: "All 3" }).click();
    await expect(page.getByText("Showing 3 of 3 skins")).toBeVisible();
    const names = await page.getByRole("article").evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")));
    expect(names).toEqual([
      "Oni Phantom, Select tier, Phantom, not owned",
      "Prime Vandal, Select tier, Vandal",
      "Reaver Omega, Select tier, Omega",
    ]);

    // Sorting by name is alphabetical regardless of weapon or ownership
    await page.getByRole("button", { name: "Name", exact: true }).click();
    const byName = await page.getByRole("article").evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")));
    expect(byName).toEqual([
      "Oni Phantom, Select tier, Phantom, not owned",
      "Prime Vandal, Select tier, Vandal",
      "Reaver Omega, Select tier, Omega",
    ]);
  });
});
