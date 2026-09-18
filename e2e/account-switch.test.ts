import { test, expect } from "playwright/test";

const ACCOUNT_1 = "MockPlayer#NA1";
const ACCOUNT_2 = "MockPlayerTwo#NA2";

/** The mock identity is selected by the access_token in the pasted auth URL. */
function mockAuthUrl(accessToken: string): string {
  return `https://playvalorant.com/opt_in#access_token=${accessToken}&id_token=mock_id_token`;
}

test.describe("Account Switch", () => {
  test("switching accounts causes store to refresh with different account's mocked data", async ({ page }) => {
    // Login as the first account
    await page.goto("/login");
    await page.getByLabel("Paste URL or Cookies").fill(mockAuthUrl("mock_access_token"));
    await page.getByRole("button", { name: "Complete Login" }).click();

    // Wait for redirect to store
    await expect(page).toHaveURL(/\/store/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Daily Store" })).toBeVisible({ timeout: 15000 });

    // Verify first account's skin names are visible
    await expect(page.getByRole("article", { name: /^Prime Vandal,/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("article", { name: /^Reaver Omega,/ })).toBeVisible({ timeout: 10000 });

    // The AccountSwitcher trigger in the header is labelled with the active
    // account. Other header buttons also carry a red accent, so match on the
    // accessible name instead of on styling.
    await page.getByRole("button", { name: ACCOUNT_1 }).click();

    // Add a second account from the dropdown
    const addAccountButton = page.getByRole("button", { name: "Add Account" });
    await expect(addAccountButton).toBeVisible({ timeout: 5000 });
    await addAccountButton.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // A different access token resolves to a different PUUID in the MSW
    // /userinfo handler, so this really registers a second account.
    await page.getByLabel("Paste URL or Cookies").fill(mockAuthUrl("mock_access_token_2"));
    await page.getByRole("button", { name: "Complete Login" }).click();

    await expect(page).toHaveURL(/\/store/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Daily Store" })).toBeVisible({ timeout: 15000 });

    // The second account is now the active one
    await expect(page.getByRole("button", { name: ACCOUNT_2 })).toBeVisible({ timeout: 10000 });

    // Switch back to the first account through the switcher
    await page.getByRole("button", { name: ACCOUNT_2 }).click();
    const firstAccountEntry = page.getByRole("button", { name: new RegExp(`${ACCOUNT_1}\\b`) });
    await expect(firstAccountEntry).toBeVisible({ timeout: 5000 });
    await firstAccountEntry.click();

    // The switcher reloads the page after switching
    await expect(page.getByRole("button", { name: ACCOUNT_1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Daily Store" })).toBeVisible({ timeout: 15000 });

    // Store shows the skins for the account we switched back to
    await expect(page.getByRole("article", { name: /^Prime Vandal,/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("article", { name: /^Reaver Omega,/ })).toBeVisible({ timeout: 10000 });
  });
});
