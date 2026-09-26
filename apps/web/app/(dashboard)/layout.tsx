"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BecomeResearcher } from "@/components/account/BecomeResearcher";
import { AppShell } from "@/components/ds/AppShell";
import { ConfirmProvider } from "@/components/ds/Dialog";
import { Mark } from "@/components/ds/Mark";
import { ErrorBox, Loading } from "@/components/page";
import { Toaster } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { errorMessage, setUnauthorizedHandler } from "@/lib/client/api";
import { signOut } from "@/lib/client/auth";
import { HealthProvider } from "@/lib/client/health";
import { allowedWithoutResearcher, MeProvider, useMe } from "@/lib/client/me";
import { clearSession, readSession, type StoredSession } from "@/lib/client/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setSession(s);
    setUnauthorizedHandler(() => {
      clearSession();
      router.replace(`/login?expired=1&next=${encodeURIComponent(window.location.pathname)}`);
    });
    return () => setUnauthorizedHandler(null);
    // Only on mount: route changes inside the dashboard keep the same session.
  }, []);

  if (!session)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background" role="status">
        <Mark className="size-8 text-foreground" />
        <span className="caps text-[11px] text-muted-foreground">Checking session…</span>
      </div>
    );

  const onSignOut = () => {
    void signOut().then(() => router.replace("/login"));
  };

  return (
    <HealthProvider>
      <MeProvider>
        <ConfirmProvider>
          <AppShell session={session} onSignOut={onSignOut}>
            <AccountGate onSignOut={onSignOut}>{children}</AccountGate>
          </AppShell>
          <Toaster />
        </ConfirmProvider>
      </MeProvider>
    </HealthProvider>
  );
}

/** Suspended → notice; not a researcher → "Become a researcher" (except Account / Admin pages). */
function AccountGate({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const pathname = usePathname();
  const { me, error, errorCode, loading, refresh, setMe } = useMe();

  if (loading && !me) return <Loading label="Loading your account…" />;
  if (errorCode === "ACCOUNT_SUSPENDED") {
    return (
      <div className="flex flex-1 items-start justify-center p-6 sm:pt-16">
        <div className="w-full max-w-md space-y-4">
          <ErrorBox message={errorMessage(error)} />
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  if (!me) return <ErrorBox className="m-6" message={errorMessage(error)} onRetry={() => void refresh()} />;
  if (!me.is_researcher && !allowedWithoutResearcher(pathname, me.is_admin)) {
    return <BecomeResearcher me={me} onDone={setMe} />;
  }
  return <>{children}</>;
}
