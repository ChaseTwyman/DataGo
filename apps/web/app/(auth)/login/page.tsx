"use client";
import Link from "next/link";
import { Hexagon, LoaderCircle, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { SignupRequestSchema, type LenientHealthResponse } from "@groundtruth/shared";
import { ErrorBox } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { signIn, signInLocalResearcher, signUp } from "@/lib/client/auth";
import { cn } from "@/lib/client/cn";
import { supabaseConfigured } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

type Tab = "signin" | "signup";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [health, setHealth] = useState<LenientHealthResponse | null | "error">(null);
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const notice = params.get("deleted") ? "Your account was deleted." : null;

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth("error"));
    if (params.get("expired")) setError("Your session expired. Sign in again.");
  }, [params]);

  const localMode = health !== null && health !== "error" && health.backend === "local";
  const canPassword = localMode || (supabaseConfigured() && health !== null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
      router.replace(next);
    } catch (e) {
      setFields(fieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onSignIn = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signIn(email.trim(), password, localMode));
  };

  const onSignUp = (e: FormEvent) => {
    e.preventDefault();
    if (!adult) return setError("You must be 18 or older to create an account.");
    if (!terms) return setError("Please accept the terms and the open-data license.");
    const parsed = SignupRequestSchema.safeParse({ email, password, display_name: name, is_adult: true, accept_terms: true });
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error));
      setError("Some fields need attention.");
      return;
    }
    void run(() => signUp(parsed.data, localMode));
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
            <div className="mb-2 grid grid-cols-2 rounded-md border p-0.5 text-sm" role="tablist" aria-label="Account">
              {(["signin", "signup"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setError(null);
                    setFields({});
                  }}
                  className={cn("cursor-pointer rounded px-3 py-1.5 font-medium", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
            <CardTitle className="text-base">{tab === "signin" ? "Welcome back" : "Create your GroundTruth account"}</CardTitle>
            <CardDescription>
              {tab === "signin"
                ? "Researchers post bounties and export datasets. Contributors can download or delete their data here."
                : "One account for contributing from the phone app and, if you like, running research. No email verification needed."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {health === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> Checking backend…
              </div>
            ) : null}
            {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}

            {canPassword && tab === "signin" ? (
              <form onSubmit={onSignIn} className="space-y-3">
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field label="Password" htmlFor="password" hint="Forgot it? Ask a GroundTruth admin for a temporary password.">
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Sign in
                </Button>
              </form>
            ) : null}

            {canPassword && tab === "signup" ? (
              <form onSubmit={onSignUp} className="space-y-3">
                <Field label="Name" htmlFor="name" error={fields.display_name} hint="Shown to researchers reviewing your captures.">
                  <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
                </Field>
                <Field label="Email" htmlFor="su-email" error={fields.email}>
                  <Input id="su-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field label="Password" htmlFor="su-password" error={fields.password} hint="At least 8 characters.">
                  <Input id="su-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                  <span>I am 18 or older.</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                  <span>
                    I accept the terms. Accepted observations are published as open data (CC BY 4.0) without my name; photos are never published.
                  </span>
                </label>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Create account
                </Button>
              </form>
            ) : null}

            {localMode && tab === "signin" ? (
              <div className="space-y-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">Local backend: skip the password and use the seeded demo admin.</p>
                <Button variant="outline" className="w-full" disabled={busy} onClick={() => void run(signInLocalResearcher)}>
                  <UserRound aria-hidden /> Continue as demo researcher
                </Button>
              </div>
            ) : null}

            {health === "error" ? <ErrorBox message="Can't reach the GroundTruth server right now. Check your connection and reload the page." /> : null}
            {health !== null && health !== "error" && !canPassword ? (
              <ErrorBox message="Sign-in isn't configured on this deployment yet." />
            ) : null}
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
