/**
 * Signed-out experience: Welcome → Create account | Sign in. Rendered by the root gate INSTEAD of
 * the router Stack, so no app screen (or deep link) is reachable without an account.
 *
 * No email is ever sent: sign-up goes through POST /api/auth/signup (confirmed immediately), then
 * we sign in with the password. There is no reset email; an admin issues a temporary password.
 */
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { devContinue, signIn, signUp } from "../api";
import { NOTICE_COPY, validateSignup, type SignupField, type SignupForm } from "../api/authFlow";
import { toUserMessage, type UserMessage } from "../api/errors";
import { log } from "../lib/log";
import { supabaseConfigured } from "../lib/supabase";
import { useApp } from "../state/appStore";
import { Body, Button, Divider, Heading, IconButton, Label, Muted, Section, StatusPill } from "../ui/components";
import { Check, PasswordField, TextField } from "../ui/forms";
import { C, S, T } from "../ui/theme";

const MARK = require("../../assets/splash-icon.png") as number;

type View_ = "welcome" | "signin" | "signup";

export function AuthFlow() {
  const [view, setView] = useState<View_>("welcome");
  const [email, setEmail] = useState("");
  if (view === "signin") return <SignIn email={email} setEmail={setEmail} onBack={() => setView("welcome")} onCreate={() => setView("signup")} />;
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
  const devBackend = health?.backend !== "supabase" || !supabaseConfigured();
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

function SignIn({ email, setEmail, onBack, onCreate }: { email: string; setEmail: (s: string) => void; onBack: () => void; onCreate: () => void }) {
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
      <Divider />
      <View style={{ gap: S.xs }}>
        <Label>Forgot password?</Label>
        <Muted>Ask an admin to issue a temporary password. Then sign in with it and change it in Account.</Muted>
      </View>
      <Button title="Create an account instead" kind="secondary" icon="user-plus" onPress={onCreate} />
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
