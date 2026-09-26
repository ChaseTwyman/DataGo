"use client";
import Link from "next/link";
import { Hexagon, LoaderCircle, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { DEMO, type LenientHealthResponse } from "@groundtruth/shared";
import { ErrorBox } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client/api";
import { signInLocalResearcher, signInWithPassword } from "@/lib/client/auth";
import { supabaseConfigured } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [health, setHealth] = useState<LenientHealthResponse | null | "error">(null);
  const [email, setEmail] = useState<string>(DEMO.researcherEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("expired") ? "Your session expired. Sign in again." : null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, []);

  const localMode = health !== null && health !== "error" && health.backend === "local";
  const showPassword = supabaseConfigured() && !localMode;
  // If the API is unreachable and Supabase isn't configured, still offer the demo path: it reports its own error.
  const showDemo = localMode || (!supabaseConfigured() && health !== null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.replace(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signInWithPassword(email, password));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,oklch(0.93_0.04_240),transparent_60%)] p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sky-500 text-white">
            <Hexagon className="size-5" aria-hidden />
          </span>
          <div>
            <div className="text-lg font-semibold">GroundTruth</div>
            <div className="text-xs text-muted-foreground">A bounty board for reality</div>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Researcher sign-in</CardTitle>
            <CardDescription>Post bounties, watch verified observations arrive, export datasets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {health === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> Checking backend…
              </div>
            ) : null}

            {showPassword ? (
              <form onSubmit={onSubmit} className="space-y-3">
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field label="Password" htmlFor="password">
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Sign in
                </Button>
              </form>
            ) : null}

            {showDemo ? (
              <div className="space-y-2">
                {localMode ? (
                  <p className="text-xs text-muted-foreground">
                    Local backend: no Supabase account needed. You&apos;ll get a dev token for a demo researcher.
                  </p>
                ) : null}
                <Button
                  size="lg"
                  variant={showPassword ? "outline" : "default"}
                  className="w-full"
                  disabled={busy}
                  onClick={() => void run(signInLocalResearcher)}
                >
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <UserRound aria-hidden />}
                  Continue as demo researcher
                </Button>
              </div>
            ) : null}

            {health === "error" ? <ErrorBox message="Can't reach the GroundTruth server right now. Check your connection and reload the page." /> : null}
            <ErrorBox message={error} />
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          Just want the data?{" "}
          <Link href="/data" className="font-medium text-foreground underline underline-offset-4">
            Browse open datasets
          </Link>{" "}
          — free, no login.
        </p>
      </div>
    </main>
  );
}

/** Only allow same-app relative redirects. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/bounties";
}
