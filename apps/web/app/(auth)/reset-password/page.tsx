"use client";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Hexagon, LoaderCircle, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorBox } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { signIn } from "@/lib/client/auth";
import { parseResetLink, validateResetConfirm, validateResetEmail, type ResetErrors } from "@/lib/client/resetPassword";

/**
 * Forgot password. Reached from "Forgot password?" on /login (email → code + new password), or
 * from the email's link (/reset-password?token_hash=…: new password only). On success the user is
 * signed in with the new password; every other session was signed out by the server.
 */
type Step = "loading" | "email" | "code" | "link" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<ResetErrors>({});
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => setLocalMode(h.backend === "local"))
      .catch(() => undefined);
    const link = parseResetLink(window.location.search, window.location.hash);
    // Keep the one-time token out of the address bar, history and any later Referer.
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (link.kind === "token") {
      setTokenHash(link.tokenHash);
      setStep("link");
    } else {
      if (link.kind === "used") setNotice("That link has expired or was already opened. Enter your email to get a new code.");
      else setEmail(link.email);
      setStep("email");
    }
  }, []);

  const fail = (e: unknown) => {
    setFields(fieldErrors(e) as ResetErrors);
    setError(errorMessage(e));
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const v = validateResetEmail(email);
    if (!v.ok) return setFields(v.errors);
    setFields({});
    setBusy(true);
    try {
      await api.requestPasswordReset(v.email);
      setEmail(v.email);
      setCode("");
      setNotice(`If ${v.email} has a GroundTruth account, we've sent it a 6-digit code. It can take a minute; check spam too.`);
      setStep("code");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validateResetConfirm({ code: step === "code" ? code : undefined, password, confirm });
    if (!v.ok) return setFields(v.errors);
    setFields({});
    setBusy(true);
    let signInEmail: string | null = null;
    try {
      const r = await api.confirmPasswordReset(
        step === "link" && tokenHash ? { token_hash: tokenHash, new_password: v.password } : { email, code: v.code ?? "", new_password: v.password },
      );
      signInEmail = r.email ?? (step === "code" ? email : null);
    } catch (err) {
      fail(err);
      setBusy(false);
      return;
    }
    setPassword("");
    setConfirm("");
    setStep("done");
    if (!signInEmail) return setBusy(false);
    try {
      await signIn(signInEmail, v.password, localMode);
      router.replace("/bounties");
    } catch (err) {
      // Password is changed; signing in is a separate step the user can do by hand.
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const title =
    step === "done" ? "Password changed" : step === "code" ? "Check your email" : step === "link" ? "Choose a new password" : "Reset your password";
  const description =
    step === "done"
      ? "You've been signed out everywhere else. Signing you in…"
      : step === "code"
        ? "Enter the code from the email and a new password."
        : step === "link"
          ? "Pick a new password for your GroundTruth account."
          : "Enter the email you signed up with and we'll send you a code.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,oklch(0.93_0.04_240),transparent_60%)] p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sky-500 text-white">
            <Hexagon className="size-5" aria-hidden />
          </span>
          <div className="text-lg font-semibold">GroundTruth</div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
              </div>
            ) : null}
            {notice && step !== "done" && step !== "link" ? (
              <p className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950" role="status">
                {step === "code" ? <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
                {notice}
              </p>
            ) : null}

            {step === "email" ? (
              <form onSubmit={(e) => void sendCode(e)} className="space-y-3" noValidate>
                <Field label="Email" htmlFor="email" error={fields.email}>
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Send code
                </Button>
              </form>
            ) : null}

            {step === "code" || step === "link" ? (
              <form onSubmit={(e) => void onConfirm(e)} className="space-y-3" noValidate>
                {step === "code" ? (
                  <Field label="6-digit code" htmlFor="code" error={fields.code}>
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={12}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="font-mono tracking-[0.3em]"
                      autoFocus
                      required
                    />
                  </Field>
                ) : null}
                <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword} error={fields.new_password} hint="At least 8 characters." />
                <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} error={fields.confirm_password} />
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Set new password
                </Button>
                {step === "code" ? (
                  <div className="flex items-center justify-between text-sm">
                    <button type="button" className="cursor-pointer text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setStep("email")}>
                      Use a different email
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void sendCode()}
                    >
                      Send a new code
                    </button>
                  </div>
                ) : (
                  <button type="button" className="cursor-pointer text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setStep("email")}>
                    Link not working? Get a code instead
                  </button>
                )}
              </form>
            ) : null}

            {step === "done" && busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> Signing you in…
              </div>
            ) : null}
            {step === "done" && !busy ? (
              <Link href="/login" className={buttonVariants({ className: "w-full" })}>
                Sign in with your new password
              </Link>
            ) : null}

            <ErrorBox message={error} />
          </CardContent>
        </Card>
        <p className="text-center text-sm">
          <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" required />
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </Field>
  );
}
