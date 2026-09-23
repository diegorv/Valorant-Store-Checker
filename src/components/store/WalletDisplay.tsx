import Image from "next/image";
import { WalletBalance } from "@/types/store";

interface WalletDisplayProps {
  /** `null` when the balances could not be read — never render that as zero */
  wallet: WalletBalance | null;
  className?: string;
}

const CONTAINER_CLASSES =
  "flex gap-6 angular-card-sm bg-void-surface/80 backdrop-blur-sm px-6 py-4 border border-white/5 shadow-lg";

export function WalletDisplay({ wallet, className = "" }: WalletDisplayProps) {
  if (!wallet) {
    return (
      <div
        className={`${CONTAINER_CLASSES} items-center ${className}`}
        role="region"
        aria-label="Wallet: balance unavailable"
      >
        <span className="text-zinc-500 text-sm font-display uppercase tracking-wider">
          Wallet Unavailable
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${CONTAINER_CLASSES} ${className}`}
      role="region"
      aria-label={`Wallet: ${wallet.vp.toLocaleString()} Valorant Points, ${wallet.rp.toLocaleString()} Radianite Points${wallet.kc ? `, ${wallet.kc.toLocaleString()} Kingdom Credits` : ''}`}
    >
      {/* Valorant Points */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 angular-card-sm bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 flex items-center justify-center border border-yellow-500/30">
          <Image src="/icons/Valorant_Points.webp" alt="VP" width={24} height={24} />
        </div>
        <div>
          <p className="text-xs text-zinc-500 font-display uppercase tracking-wider">
            VP
          </p>
          <p className="text-lg font-bold text-white font-mono tracking-wider">
            {wallet.vp.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Radianite Points */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 angular-card-sm bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center border border-green-500/30">
          <Image src="/icons/Radianite_Points.webp" alt="RP" width={24} height={24} />
        </div>
        <div>
          <p className="text-xs text-zinc-500 font-display uppercase tracking-wider">
            RP
          </p>
          <p className="text-lg font-bold text-white font-mono tracking-wider">
            {wallet.rp.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Kingdom Credits (optional) */}
      {wallet.kc !== undefined && wallet.kc > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 angular-card-sm bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center border border-blue-500/30">
            <Image src="/icons/Kingdom_Credits.webp" alt="KC" width={24} height={24} />
          </div>
          <div>
            <p className="text-xs text-zinc-500 font-display uppercase tracking-wider">
              KC
            </p>
            <p className="text-lg font-bold text-white font-mono tracking-wider">
              {wallet.kc.toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
