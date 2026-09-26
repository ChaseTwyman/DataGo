"use client";
import Link from "next/link";
import { LoaderCircle, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { SignupRequestSchema, type LenientHealthResponse } from "@groundtruth/shared";
import { AuthHeading, AuthLayout } from "@/components/ds/AuthLayout";
import { Checkbox, Tabs } from "@/components/ds/controls";
import { LoadingState, Notice } from "@/components/ds/primitives";
import { ErrorBox } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { signIn, signInLocalResearcher, signUp } from "@/lib/client/auth";
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
    <AuthLayout>
      <AuthHeading eyebrow="Researcher console" title={tab === "signin" ? "Sign in" : "Create account"}>
        {tab === "signin"
          ? "Researchers post bounties and export datasets. Contributors can download or delete their data here."
          : "One account for contributing from the phone app and, if you like, running research. No email verification needed."}
      </AuthHeading>
      <Tabs
        label="Account"
        className="mb-6 w-full"
        items={[
          { id: "signin", label: "Sign in" },
          { id: "signup", label: "Create account" },
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setError(null);
          setFields({});
        }}
      />
      <div className="space-y-5">
        {health === null ? <LoadingState inline label="Checking backend…" className="p-0" /> : null}
        {notice ? <Notice tone="info">{notice}</Notice> : null}

        {canPassword && tab === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <div className="-mt-1 text-right">
              <Link
                href={email.trim() ? `/reset-password?email=${encodeURIComponent(email.trim())}` : "/reset-password"}
                className="caps text-[11px] text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </Link>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Sign in
            </Button>
          </form>
        ) : null}

        {canPassword && tab === "signup" ? (
          <form onSubmit={onSignUp} className="space-y-4">
            <Field label="Name" htmlFor="name" error={fields.display_name} hint="Shown to researchers reviewing your captures.">
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </Field>
            <Field label="Email" htmlFor="su-email" error={fields.email}>
              <Input id="su-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" htmlFor="su-password" error={fields.password} hint="At least 8 characters.">
              <Input id="su-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Checkbox label="I am 18 or older." checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <Checkbox
              label="I accept the terms. Accepted observations are published as open data (CC BY 4.0) without my name; photos are never published."
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Create account
            </Button>
          </form>
        ) : null}

        {localMode && tab === "signin" ? (
          <div className="space-y-2 border-t pt-5">
            <p className="text-xs text-muted-foreground">Local backend: skip the password and use the seeded demo admin.</p>
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void run(signInLocalResearcher)}>
              <UserRound aria-hidden /> Continue as demo researcher
            </Button>
          </div>
        ) : null}

        {health === "error" ? <ErrorBox message="Can't reach the GroundTruth server right now. Check your connection and reload the page." /> : null}
        {health !== null && health !== "error" && !canPassword ? <ErrorBox message="Sign-in isn't configured on this deployment yet." /> : null}
        <ErrorBox message={error} />
      </div>
    </AuthLayout>
  );
}

/** Only allow same-app relative redirects. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/bounties";
}
