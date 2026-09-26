"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Loading } from "@/components/page";
import { Sidebar } from "@/components/Sidebar";
import { setUnauthorizedHandler } from "@/lib/client/api";
import { signOut } from "@/lib/client/auth";
import { HealthProvider } from "@/lib/client/health";
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

  if (!session) return <Loading label="Checking session…" className="h-screen justify-center" />;

  return (
    <HealthProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          session={session}
          onSignOut={() => {
            void signOut().then(() => router.replace("/login"));
          }}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </HealthProvider>
  );
}
