import { redirect } from "next/navigation";
import { getSessionWithRefresh } from "@/lib/session";
import { LoginFormLoader } from "@/components/auth/LoginFormLoader";

export const metadata = {
  title: "Sign In | Valorant Store Checker",
  description: "Sign in with your Riot Games account to check your Valorant store.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ addAccount?: string }>;
}) {
  const params = await searchParams;

  // Redirect to /store only when the session is one /store will accept.
  //
  // /store decides the opposite direction with getSessionWithRefresh(), so
  // this page must use the same predicate: if the two ever disagree the
  // browser bounces between them until it fails with "too many redirects".
  // A session whose Riot refresh failed stays on the login form so the user
  // can re-authenticate instead of being sent to a store that cannot load.
  //
  // Skipped for the multi-account flow, which adds an account on top of a
  // valid session.
  if (!params.addAccount) {
    const session = await getSessionWithRefresh();
    if (session && !session._refreshFailed) {
      redirect("/store");
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Animated scan line */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="w-full h-[2px] bg-gradient-to-r from-transparent via-brand/20 to-transparent animate-scanline" />
      </div>

      {/* Diagonal grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 40px,
            rgba(255,255,255,0.5) 40px,
            rgba(255,255,255,0.5) 41px
          )`,
        }}
      />

      {/* Dramatic red orbs */}
      <div className="absolute top-1/3 -left-40 w-96 h-96 bg-brand/8 rounded-full blur-3xl animate-subtle-float" />
      <div className="absolute bottom-1/3 -right-40 w-96 h-96 bg-brand/6 rounded-full blur-3xl animate-subtle-float" style={{ animationDelay: "3s" }} />

      {/* Login Form Container */}
      <div
        className="relative z-10 w-full max-w-md stagger-entrance"
        style={{ "--stagger-delay": "0ms" } as React.CSSProperties}
      >
        <LoginFormLoader />
      </div>
    </div>
  );
}
