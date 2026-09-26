/**
 * Signed-out experience: Welcome → Create account | Sign in. Rendered by the root gate INSTEAD of
 * the router Stack, so no app screen (or deep link) is reachable without an account.
 *
 * Sign-up sends no email: it goes through POST /api/auth/signup (confirmed immediately), then we
 * sign in with the password. Forgot password: Sign in → "Forgot password?" → email → emailed
 * 6-digit code + new password → signed in. An admin-issued temporary password still works too.
 */
import { useEffect, useReducer, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { confirmPasswordReset, devContinue, requestPasswordReset, signIn, signUp } from "../api";
import {
  NOTICE_COPY,
  RESET_INITIAL,
  resendWaitSeconds,
  resetReducer,
  validateResetEmail,
  validateResetForm,
  validateSignup,
  type ResetField,
  type SignupField,
  type SignupForm,
} from "../api/authFlow";
import { toResetMessage, toUserMessage, type UserMessage } from "../api/errors";
import { log } from "../lib/log";
import { supabaseConfigured } from "../lib/supabase";
import { useApp } from "../state/appStore";
import { Body, Button, Divider, Heading, IconButton, Muted, Section, StatusPill } from "../ui/components";
import { Check, PasswordField, TextField } from "../ui/forms";
import { C, S, T } from "../ui/theme";

const MARK = require("../../assets/splash-icon.png") as number;

type View_ = "welcome" | "signin" | "signup" | "forgot";

export function AuthFlow() {
  const [view, setView] = useState<View_>("welcome");
  const [email, setEmail] = useState("");
  if (view === "forgot") return <ForgotPassword email={email} setEmail={setEmail} onBack={() => setView("signin")} />;
  if (view === "signin") return <SignIn email={email} setEmail={setEmail} onBack={() => setView("welcome")} onCreate={() => setView("signup")} onForgot={() => setView("forgot")} />;
  if (view === "signup") return <SignUp email={email} setEmail={setEmail} onBack={() => setView("welcome")} onSignIn={() => setView("signin")} />;
  return <Welcome onCreate={() => setView("signup")} onSignIn={() => setView("signin")} />;
}

function Frame({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {onBack ? (
        <View style={{ paddingTop: insets.top + S.sm, paddingHorizontal: S.sm }}>
          <IconButton icon="chevron-left" label="Back" onPress={onBack} />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingTop: onBack ? S.md : insets.top + S.xxl, paddingBottom: insets.bottom + S.xxl, gap: S.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Welcome({ onCreate, onSignIn }: { onCreate: () => void; onSignIn: () => void }) {
  const notice = useApp((s) => s.authNotice);
  const health = useApp((s) => s.health);
  // Local dev backend (LOCAL_BACKEND=1) has no Supabase accounts; development only.
  // __DEV__ too: a misconfigured Release build must never offer a password-less way in.
  const devBackend = __DEV__ && (health?.backend !== "supabase" || !supabaseConfigured());
  const [busy, setBusy] = useState(false);
  return (
    <Frame>
      <View style={{ gap: S.lg, marginTop: S.xxl }}>
        <Image source={MARK} style={{ width: 72, height: 72 }} accessibilityIgnoresInvertColors accessibilityLabel="GroundTruth mark" />
        <Heading size={T.hero}>GroundTruth</Heading>
        <Body color={C.muted}>Get paid to capture verified, research-grade observations of the world around you.</Body>
      </View>
      {notice ? <StatusPill tone="info" icon="info" text={NOTICE_COPY[notice]} /> : null}
      <View style={{ gap: S.md, marginTop: S.xl }}>
        {devBackend ? (
          <>
            <Button
              title="Continue (dev backend)"
              icon="terminal"
              loading={busy}
              onPress={() => {
                setBusy(true);
                void devContinue().finally(() => setBusy(false));
              }}
            />
            <Muted>Local development backend: accounts are simulated with a dev session.</Muted>
          </>
        ) : (
          <>
            <Button title="Create account" icon="user-plus" onPress={onCreate} />
            <Button title="Sign in" kind="secondary" icon="log-in" onPress={onSignIn} />
          </>
        )}
      </View>
      <Muted>One account works for contributing here and for researcher tools on the web dashboard.</Muted>
    </Frame>
  );
}

function ErrorLine({ err, onSignIn }: { err: UserMessage; onSignIn?: () => void }) {
  return (
    <View style={{ gap: S.sm }} accessibilityLiveRegion="polite">
      <StatusPill tone="bad" text={err.message} />
      {err.code === "EMAIL_TAKEN" && onSignIn ? <Button title="Sign in instead" kind="secondary" icon="log-in" onPress={onSignIn} /> : null}
    </View>
  );
}

function SignIn({
  email,
  setEmail,
  onBack,
  onCreate,
  onForgot,
}: {
  email: string;
  setEmail: (s: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onForgot: () => void;
}) {
  const notice = useApp((s) => s.authNotice);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<UserMessage | null>(null);
  const canSubmit = email.trim().length > 3 && password.length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await signIn(email, password);
    } catch (e) {
      log.handled("sign-in", e);
      setErr(toUserMessage(e));
      setBusy(false);
    }
  };

  return (
    <Frame onBack={onBack}>
      <Heading>Sign in</Heading>
      {notice === "session_ended" ? <StatusPill tone="info" icon="info" text={NOTICE_COPY.session_ended} /> : null}
      <TextField
        label="Email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
      />
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
      {err ? <ErrorLine err={err} /> : null}
      <Button title="Sign in" icon="log-in" onPress={() => void submit()} disabled={!canSubmit} loading={busy} />
      <Button title="Forgot password?" kind="secondary" icon="key" onPress={onForgot} />
      <Divider />
      <Button title="Create an account instead" kind="secondary" icon="user-plus" onPress={onCreate} />
    </Frame>
  );
}

/** Forgot password: email → 6-digit code + new password → signed in (the gate then shows the app). */
function ForgotPassword({ email, setEmail, onBack }: { email: string; setEmail: (s: string) => void; onBack: () => void }) {
  const [state, dispatch] = useReducer(resetReducer, RESET_INITIAL);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ResetField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<UserMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wait = resendWaitSeconds(state, now);

  // Tick the resend countdown only while it runs.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const clear = (f: ResetField) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  const send = async () => {
    if (busy) return;
    setErr(null);
    const v = validateResetEmail(state.step === "code" && state.sentTo ? state.sentTo : email);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      await requestPasswordReset(v.email);
      const at = Date.now();
      setNow(at);
      setCode("");
      dispatch({ type: "sent", email: v.email, at });
    } catch (e) {
      log.handled("reset-request", e);
      setErr(toResetMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || !state.sentTo) return;
    setErr(null);
    const v = validateResetForm({ code, password, confirm });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      await confirmPasswordReset(state.sentTo, v.code, v.password);
    } catch (e) {
      log.handled("reset-confirm", e);
      setErr(toResetMessage(e));
      setBusy(false);
      return;
    }
    dispatch({ type: "done" });
    try {
      await signIn(state.sentTo, v.password); // success unmounts this screen via the account gate
    } catch (e) {
      log.handled("reset-sign-in", e);
      setErr(toUserMessage(e));
      setBusy(false);
    }
  };

  if (state.step === "done") {
    return (
      <Frame onBack={onBack}>
        <View style={{ gap: S.sm }} accessibilityLiveRegion="polite">
          <StatusPill tone="ok" icon="check" text="Password changed" />
          <Heading>You're all set</Heading>
          <Body color={C.muted}>Your new password works now, and you've been signed out on every other device.</Body>
        </View>
        {busy ? <Muted>Signing you in…</Muted> : null}
        {err ? <ErrorLine err={err} /> : null}
        {!busy ? <Button title="Sign in" icon="log-in" onPress={onBack} /> : null}
      </Frame>
    );
  }

  if (state.step === "email") {
    return (
      <Frame onBack={onBack}>
        <Heading>Reset password</Heading>
        <Body color={C.muted}>Enter the email you signed up with. We'll send you a 6-digit code.</Body>
        <TextField
          label="Email"
          value={email}
          onChange={(s) => (setEmail(s), clear("email"))}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          error={errors.email}
        />
        {err ? <ErrorLine err={err} /> : null}
        <Button title="Send code" icon="mail" onPress={() => void send()} loading={busy} disabled={email.trim().length === 0} />
        <Muted>No email, or no access to it? Ask a GroundTruth admin for a temporary password.</Muted>
      </Frame>
    );
  }

  return (
    <Frame onBack={() => dispatch({ type: "change_email" })}>
      <Heading>Check your email</Heading>
      <Body color={C.muted}>If {state.sentTo} has a GroundTruth account, we've sent it a 6-digit code. It can take a minute; check spam too.</Body>
      <TextField
        label="6-digit code"
        value={code}
        onChange={(s) => (setCode(s), clear("code"))}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        error={errors.code}
      />
      <PasswordField
        label="New password"
        value={password}
        onChange={(s) => (setPassword(s), clear("new_password"))}
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.new_password}
        hint="At least 8 characters."
      />
      <PasswordField
        label="Confirm new password"
        value={confirm}
        onChange={(s) => (setConfirm(s), clear("confirm_password"))}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        error={errors.confirm_password}
      />
      {err ? <ErrorLine err={err} /> : null}
      <Button title="Set new password" icon="lock" onPress={() => void submit()} loading={busy} />
      <Button title={wait > 0 ? `Send a new code (${wait}s)` : "Send a new code"} kind="secondary" icon="refresh-cw" onPress={() => void send()} disabled={busy || wait > 0} />
      <Button title="Use a different email" kind="secondary" icon="at-sign" onPress={() => dispatch({ type: "change_email" })} disabled={busy} />
    </Frame>
  );
}

function SignUp({ email, setEmail, onBack, onSignIn }: { email: string; setEmail: (s: string) => void; onBack: () => void; onSignIn: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<UserMessage | null>(null);

  const form: SignupForm = { display_name: name, email, password, is_adult: adult, accept_terms: terms };

  const submit = async () => {
    if (busy) return;
    setErr(null);
    const v = validateSignup(form);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await signUp(v.data);
    } catch (e) {
      log.handled("sign-up", e);
      setErr(toUserMessage(e));
      setBusy(false);
    }
  };

  // Re-validate a field as soon as the user fixes it, so stale errors don't linger.
  const clear = (f: SignupField) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  return (
    <Frame onBack={onBack}>
      <Heading>Create account</Heading>
      <Section index={0} title="Account">
        <TextField label="Display name" value={name} onChange={(s) => (setName(s), clear("display_name"))} placeholder="e.g. Sam" error={errors.display_name} autoComplete="name" textContentType="nickname" />
        <TextField
          label="Email"
          value={email}
          onChange={(s) => (setEmail(s), clear("email"))}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
          error={errors.email}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={(s) => (setPassword(s), clear("password"))}
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
          hint="At least 8 characters."
        />
      </Section>
      <Section index={1} title="Eligibility and license">
        <Check checked={adult} onToggle={() => (setAdult((v) => !v), clear("is_adult"))} label="I am 18 or older." error={errors.is_adult} />
        <Divider />
        <Check
          checked={terms}
          onToggle={() => (setTerms((v) => !v), clear("accept_terms"))}
          label="I accept the terms and license my accepted observations under CC BY 4.0. Accepted observations are published as open data; your photos are never published."
          error={errors.accept_terms}
        />
      </Section>
      {err ? <ErrorLine err={err} onSignIn={onSignIn} /> : null}
      <Button title="Create account" icon="user-plus" onPress={() => void submit()} loading={busy} />
      <Muted>No confirmation email is sent. You'll be signed in right away.</Muted>
    </Frame>
  );
}
