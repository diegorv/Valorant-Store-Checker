import { WalletDisplay } from "@/components/store/WalletDisplay";
import { getWallet } from "@/lib/store-service";
import { StoreTokens } from "@/lib/riot-store";
import { CURRENCY_IDS } from "@/types/riot";

interface WalletSectionProps {
  session: StoreTokens;
}

export async function WalletSection({ session }: WalletSectionProps) {
  const wallet = await getWallet(session);
  const vp = wallet?.Balances[CURRENCY_IDS.VP];
  const rp = wallet?.Balances[CURRENCY_IDS.RP];
  const kc = wallet?.Balances[CURRENCY_IDS.KC];

  // A balance Riot did not send is unknown, not zero: the user makes purchase
  // decisions on these numbers, so an absent VP or RP renders as unavailable.
  // KC stays optional — the wallet displays fine without it.
  return (
    <WalletDisplay
      wallet={vp === undefined || rp === undefined ? null : { vp, rp, kc }}
    />
  );
}
