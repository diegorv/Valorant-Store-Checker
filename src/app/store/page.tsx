import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionWithRefresh, revokeCurrentSession } from "@/lib/session";
import { fetchUserStore } from "@/lib/store-service";
import { RiotStoreHttpError } from "@/lib/riot-store";
import type { StoreData } from "@/types/store";
import { WalletSection } from "@/components/store/server/WalletSection";
import { DailyStoreSection } from "@/components/store/server/DailyStoreSection";
import { BundleSection } from "@/components/store/server/BundleSection";
import { NightMarketSection } from "@/components/store/server/NightMarketSection";
import { LoadingSkeleton } from "@/components/store/LoadingSkeleton";
import { LogoutButtonClient } from "@/components/store/LogoutButtonClient";
import { SectionErrorBoundary } from "@/components/store/SectionErrorBoundary";

// Store page reads session cookies — must be dynamically rendered per request.
export const dynamic = "force-dynamic";

/**
 * Store Page — async Server Component
 *
 * Data flow:
 * 1. Authenticate & get session (blocks — required for every downstream call).
 * 2. `fetchUserStore` fetches storefront + static data in parallel, then
 *    hydrates daily items, bundles, and night market in parallel.
 * 3. Wallet is fetched independently inside `<WalletSection>`, wrapped in
 *    its own Suspense boundary so it renders as soon as it resolves without
 *    blocking the main content.
 */
export default async function StorePage() {
  const session = await getSessionWithRefresh();

  // Same predicate /login uses (see the comment there): a session whose Riot
  // refresh failed is truthy but carries a dead access token, so every
  // downstream call can only answer 401. Send the user to the login form
  // instead of rendering an error panel.
  if (!session || session._refreshFailed) {
    redirect("/login");
  }

  // Single orchestration call — replaces manual getStorefront + getStoreStaticData
  let storeData: StoreData | null;
  try {
    storeData = await fetchUserStore(session);
  } catch (error) {
    // Riot can reject tokens the refresh path was happy with — revoked from
    // another client, expired entitlements. Decided on the HTTP status, which
    // is the server's own: error.tsx cannot decide it, because the message it
    // receives is replaced by a digest outside development.
    //
    // Dropping the session first is what lets the redirect land: /login sends a
    // session it still considers usable straight back here. Best-effort — another
    // instance can still be inside its own session-cache window and bounce once,
    // the residual hazard already documented on dropDeadSession.
    if (error instanceof RiotStoreHttpError && error.status === 401) {
      await revokeCurrentSession();
      redirect("/login");
    }
    throw error;
  }

  if (!storeData) {
    return (
      <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto text-center py-20">
          <h1 className="font-display text-4xl uppercase font-bold text-light mb-4">Store Unavailable</h1>
          <p className="text-zinc-400">Failed to load store data. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 stagger-entrance">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="font-display text-5xl md:text-6xl uppercase font-bold text-light mb-2">
                Your Store
              </h1>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <SectionErrorBoundary sectionName="Wallet" compact>
                <Suspense fallback={<div className="h-10 w-32 bg-white/5 rounded animate-pulse" />}>
                  <WalletSection session={session} />
                </Suspense>
              </SectionErrorBoundary>
              
              <LogoutButtonClient />
            </div>
          </div>
        </div>

        {/* Content — bundles, daily store, night market */}
        <SectionErrorBoundary sectionName="Featured Bundle">
          <Suspense fallback={<LoadingSkeleton text="Loading Bundle..." />}>
            <BundleSection storeData={storeData} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Daily Store">
          <Suspense fallback={<LoadingSkeleton text="Loading Daily Store..." />}>
            <DailyStoreSection session={session} storeData={storeData} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Night Market">
          <Suspense fallback={<LoadingSkeleton text="Loading Night Market..." />}>
            <NightMarketSection session={session} storeData={storeData} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
