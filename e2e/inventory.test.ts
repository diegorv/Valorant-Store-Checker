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

    // The owned-skin count comes from the PD entitlements handler. An empty
    // collection also renders the page happily, so assert the real number.
    await expect(page.getByText("2 Skins", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Showing 2 of 2 skins")).toBeVisible({ timeout: 15000 });

    // Each card's accessible name is "<skin>, <tier> tier, <weapon>". The tier
    // and the weapon are not in the entitlements payload — they only exist once
    // the level UUIDs are resolved against the Valorant-API handlers, so these
    // labels prove the hydration path ran rather than a fallback entry.
    await expect(page.getByRole("article", { name: "Prime Vandal, Select tier, Vandal" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("article", { name: "Reaver Omega, Select tier, Omega" })).toBeVisible({ timeout: 15000 });
  });
});
