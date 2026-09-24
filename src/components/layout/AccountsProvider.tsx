"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("AccountsProvider");

export interface Account {
  puuid: string;
  region: string;
  gameName?: string;
  tagLine?: string;
  addedAt: number;
  isActive: boolean;
}

interface AccountsContextValue {
  accounts: Account[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

export function useAccounts(): AccountsContextValue {
  const context = useContext(AccountsContext);
  if (!context) {
    throw new Error("useAccounts must be used inside an AccountsProvider");
  }
  return context;
}

/**
 * Holds the account list for every AccountSwitcher on the page.
 *
 * The switcher is mounted twice — once in the desktop nav and once in the
 * mobile drawer, which is always in the DOM and merely hidden with CSS — so
 * fetching per instance meant two requests to /api/accounts on every page
 * load. The list is fetched here once and shared.
 *
 * Renders no element of its own, so it can wrap header content without
 * changing the layout.
 */
export function AccountsProvider({
  isLoggedIn,
  children,
}: {
  isLoggedIn: boolean;
  children: React.ReactNode;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(isLoggedIn);

  // Fetch the list on mount. The drawer stays mounted when logged out, where
  // the endpoint would only answer 401.
  useEffect(() => {
    if (isLoggedIn) {
      refresh();
    }
  }, [isLoggedIn]);

  async function refresh() {
    try {
      const response = await fetch("/api/accounts");
      if (!response.ok) {
        throw new Error(`Failed to fetch accounts: ${response.statusText}`);
      }

      const data = await response.json();
      setAccounts(data.accounts || []);
      log.info(`Loaded ${data.accounts?.length || 0} accounts`);
    } catch (error) {
      log.error("Failed to fetch accounts:", error);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AccountsContext.Provider value={{ accounts, loading, refresh }}>
      {children}
    </AccountsContext.Provider>
  );
}
