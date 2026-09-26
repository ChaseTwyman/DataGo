/**
 * Account: who you are, trust + balance, researcher tools (web dashboard), change password,
 * download my data, delete my account, sign out. Reached from the Wallet tab header.
 */
import { ChangePasswordRequestSchema } from "@groundtruth/shared";
import { File, Paths } from "expo-file-system";
import { useState } from "react";
import { Linking, Platform, ScrollView, Share, Text, TextInput, View } from "react-native";
import { api, endSession, signOut } from "../src/api";
import { dashboardUrl, deleteConfirmed } from "../src/api/authFlow";
import { toUserMessage } from "../src/api/errors";
import { useMe } from "../src/api/queries";
import { ENV } from "../src/lib/env";
import { log } from "../src/lib/log";
import { Body, Button, Divider, ErrorBox, Label, LoadingState, Money, Muted, Readout, Section, StatusPill } from "../src/ui/components";
import { FieldError, PasswordField } from "../src/ui/forms";
import { C, F, S, T, TOUCH } from "../src/ui/theme";

export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/ErrorFallback";

const DASHBOARD = dashboardUrl(ENV.apiBaseUrl);

const openDashboard = () => void Linking.openURL(DASHBOARD).catch((e: unknown) => log.handled("open-dashboard", e));

export default function Account() {
  const me = useMe();
  const d = me.data;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.xxl, paddingBottom: S.xxl * 2 }} keyboardShouldPersistTaps="handled">
      {!d && me.isLoading ? <LoadingState label="Loading account…" /> : null}
      {!d && me.error ? <ErrorBox title="Couldn't load your account" message={toUserMessage(me.error).message} onRetry={() => void me.refetch()} /> : null}
      {d ? (
        <Section title="Profile">
          <View style={{ gap: S.xs }}>
            <Body size={T.title}>{d.display_name ?? "Contributor"}</Body>
            {d.email ? <Muted>{d.email}</Muted> : null}
          </View>
          <View style={{ flexDirection: "row", gap: S.xl, flexWrap: "wrap" }}>
            <Readout label="Trust score" value={d.trust_score.toFixed(2)} size={28} />
            <View style={{ gap: S.xs }}>
              <Label>Balance · simulated</Label>
              <Money cents={d.balance_cents} size={28} />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: S.sm, flexWrap: "wrap" }}>
            <StatusPill tone="ok" icon="camera" text="Contributor" />
            {d.is_researcher ? <StatusPill tone="info" icon="book-open" text="Researcher" /> : null}
            {d.is_admin ? <StatusPill tone="info" icon="shield" text="Admin" /> : null}
          </View>
        </Section>
      ) : null}

      <Section title="Researcher tools">
        <Body color={C.muted}>Researcher tools are on the web dashboard. Sign in there with this same email and password.</Body>
        <Text selectable style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: T.bodySmall }}>{DASHBOARD}</Text>
        {d?.is_researcher ? (
          <Button title="Open dashboard" kind="secondary" icon="external-link" onPress={openDashboard} />
        ) : (
          <Button title="Become a researcher" kind="secondary" icon="external-link" onPress={openDashboard} />
        )}
      </Section>

      <ChangePassword />
      <DownloadData />
      <DeleteAccount />

      <Section title="Session">
        <SignOut />
      </Section>
    </ScrollView>
  );
}

function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      title="Sign out"
      kind="secondary"
      icon="log-out"
      loading={busy}
      onPress={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
    />
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr(null);
    setDone(false);
    const v = ChangePasswordRequestSchema.safeParse({ current_password: current, new_password: next });
    if (!v.success) {
      setFieldErr(next.length > 72 ? "Use at most 72 characters." : current ? "Use at least 8 characters." : "Enter your current password.");
      return;
    }
    setFieldErr(null);
    setBusy(true);
    try {
      await api.changePassword(v.data);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (e) {
      log.handled("change-password", e);
      const m = toUserMessage(e);
      setErr(m.code === "INVALID_CREDENTIALS" ? "Your current password isn't right. Check it and try again." : m.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Change password">
      <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" textContentType="password" />
      <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters." />
      {fieldErr ? <FieldError text={fieldErr} /> : null}
      {err ? <StatusPill tone="bad" text={err} /> : null}
      {done ? <StatusPill tone="ok" text="Password changed." /> : null}
      <Button title="Change password" kind="secondary" icon="key" onPress={() => void submit()} loading={busy} disabled={!current || !next} />
    </Section>
  );
}

function exportFileName(now = new Date()): string {
  return `groundtruth-export-${now.toISOString().slice(0, 10)}.json`;
}

function DownloadData() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedKb, setSavedKb] = useState<number | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setSavedKb(null);
    let json: string;
    try {
      json = JSON.stringify(await api.exportData(), null, 2);
    } catch (e) {
      log.handled("export", e);
      setErr(toUserMessage(e).message);
      setBusy(false);
      return;
    }
    try {
      if (Platform.OS === "ios") {
        // JS-only: write to the cache dir (expo-file-system, already in the build), then the
        // system share sheet (React Native core) offers Save to Files, AirDrop, Mail, …
        const file = new File(Paths.cache, exportFileName());
        file.create({ overwrite: true });
        file.write(json);
        await Share.share({ url: file.uri, title: "GroundTruth data export" });
      } else {
        await Share.share({ message: json, title: "GroundTruth data export" });
      }
      setSavedKb(Math.max(1, Math.round(json.length / 1024)));
    } catch (e) {
      log.handled("export-share", e);
      setErr("Couldn't open the share sheet. You can also download your data from your account settings on the web dashboard.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Your data">
      <Body color={C.muted}>Download everything we hold about you: profile, capture sessions, submissions (with links to your photos) and wallet history, as a JSON file.</Body>
      {err ? <StatusPill tone="bad" text={err} /> : null}
      {savedKb !== null ? <StatusPill tone="ok" text={`Export ready (${savedKb} KB).`} /> : null}
      <Button title="Download my data" kind="secondary" icon="download" onPress={() => void run()} loading={busy} />
      <Muted>Photo links in the export expire after a while; download again for fresh ones.</Muted>
    </Section>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = deleteConfirmed(typed);

  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteAccount({ confirm: "DELETE" });
    } catch (e) {
      log.handled("delete-account", e);
      setErr(toUserMessage(e).message);
      setBusy(false);
      return;
    }
    await endSession("account_deleted");
  };

  return (
    <Section title="Delete account">
      <Body color={C.muted}>
        Permanently deletes your account, profile, photos, capture sessions and wallet, including any unpaid balance. Accepted observations already
        published as open data stay in the public dataset, de-identified: they are no longer linked to you. This can't be undone.
      </Body>
      {!open ? (
        <Button title="Delete my account" kind="danger" icon="trash-2" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: S.md }}>
          <Divider />
          <Label>Type DELETE to confirm</Label>
          <View style={{ minHeight: TOUCH, borderBottomWidth: 1, borderColor: ok ? C.red : C.hairline, justifyContent: "center" }}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder="DELETE"
              placeholderTextColor={C.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm account deletion"
              style={{ minHeight: TOUCH, color: C.text, fontFamily: F.bodyMedium, fontSize: T.body }}
            />
          </View>
          {err ? <StatusPill tone="bad" text={err} /> : null}
          <Button title="Permanently delete" kind="danger" icon="trash-2" onPress={() => void run()} disabled={!ok} loading={busy} style={!ok ? { opacity: 0.4 } : undefined} />
          <Button
            title="Cancel"
            kind="secondary"
            onPress={() => {
              setOpen(false);
              setTyped("");
              setErr(null);
            }}
            disabled={busy}
          />
        </View>
      )}
    </Section>
  );
}
