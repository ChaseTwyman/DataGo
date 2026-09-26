/**
 * Onboarding (PRD §7.1), shown once per phone after sign-up/sign-in: permissions (camera, mic,
 * location while using) and the optional profile form (voice interview is P1). Age (18+) and the
 * terms + CC BY 4.0 license are confirmed at account creation, so they are not asked again here.
 */
import * as Location from "expo-location";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AudioManager } from "react-native-audio-api";
import { useCameraPermission } from "react-native-vision-camera";
import { toUserMessage } from "../src/api/errors";
import { splitList } from "../src/grokbot/profile";
import { saveProfile } from "../src/grokbot/saveProfile";
import { log } from "../src/lib/log";
import { useApp } from "../src/state/appStore";
import { useMe } from "../src/api/queries";
import { Body, Button, Heading, Icon, Label, Muted, Section, StatusPill, type IconName } from "../src/ui/components";
import { TextField } from "../src/ui/forms";
import { C, F, S, T, TOUCH } from "../src/ui/theme";

type Perm = "unknown" | "granted" | "denied";

const MARK = require("../assets/splash-icon.png") as number;

export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/ErrorFallback";

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const cam = useCameraPermission();
  const [mic, setMic] = useState<Perm>("unknown");
  const [loc, setLoc] = useState<Perm>("unknown");
  const [occupation, setOccupation] = useState("");
  const [skills, setSkills] = useState("");
  const [interests, setInterests] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setOnboarded = useApp((s) => s.setOnboarded);
  const me = useMe();
  const firstName = me.data?.display_name?.trim().split(/\s+/)[0] ?? null;

  // Each prompt independently: one failing (or throwing) must not skip the others.
  const askAll = async () => {
    try {
      await cam.requestPermission();
    } catch (e) {
      log.handled("perm-camera", e);
    }
    try {
      setMic((await AudioManager.requestRecordingPermissions()) === "Granted" ? "granted" : "denied");
    } catch (e) {
      log.handled("perm-mic", e);
      setMic("denied");
    }
    try {
      setLoc((await Location.requestForegroundPermissionsAsync()).status === "granted" ? "granted" : "denied");
    } catch (e) {
      log.handled("perm-location", e);
      setLoc("denied");
    }
  };

  const finish = async () => {
    setSaving(true);
    setErr(null);
    try {
      // 18+ and the license were confirmed when the account was created (sign-up requires both).
      // Saving also refreshes the For-you matches in the background (errors there are ignored).
      await saveProfile({
        is_adult: true,
        consent_license: true,
        ...(occupation.trim() ? { occupation: occupation.trim().slice(0, 120) } : {}),
        ...(skills.trim() ? { skills: splitList(skills) } : {}),
        ...(interests.trim() ? { interests: splitList(interests) } : {}),
      });
      setOnboarded(true);
      router.replace("/map");
    } catch (e) {
      log.handled("onboarding", e);
      setErr(toUserMessage(e).message);
    } finally {
      setSaving(false);
    }
  };

  const camState: Perm = cam.hasPermission ? "granted" : cam.canRequestPermission ? "unknown" : "denied";
  const permsOk = cam.hasPermission && mic === "granted" && loc === "granted";
  const anyDenied = camState === "denied" || mic === "denied" || loc === "denied";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: insets.top + S.xl, gap: S.xxl, paddingBottom: S.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: S.lg }}>
          <Image source={MARK} style={{ width: 56, height: 56 }} accessibilityIgnoresInvertColors accessibilityLabel="GroundTruth mark" />
          <Heading size={T.hero}>{firstName ? `Welcome, ${firstName}` : "Welcome"}</Heading>
          <Body color={C.muted}>Two quick steps. A voice guide coaches you through every capture, hands-free.</Body>
        </View>

        <Section index={0} title="Permissions">
          <PermRow icon="camera" label="Camera" detail="In-app capture only" state={camState} />
          <PermRow icon="mic" label="Microphone" detail="Voice field guide" state={mic} />
          <PermRow icon="map-pin" label="Location" detail="Only while using the app" state={loc} />
          <Button title={permsOk ? "Access granted" : "Allow access"} kind={permsOk ? "secondary" : "primary"} icon={permsOk ? "check" : "unlock"} onPress={() => void askAll()} disabled={permsOk} />
          {anyDenied ? (
            <View style={{ gap: S.sm }}>
              <Muted>iOS won't ask again for a permission you turned down. You can switch it on in Settings — or continue, and turn it on later.</Muted>
              <Button title="Open Settings" kind="secondary" icon="settings" onPress={() => void Linking.openSettings().catch(() => undefined)} />
            </View>
          ) : null}
        </Section>

        <Section index={1} title="About you" right={<Label>Optional</Label>}>
          <TextField label="Occupation" value={occupation} onChange={setOccupation} placeholder="e.g. civil engineer" />
          <TextField label="Skills" value={skills} onChange={setSkills} placeholder="Comma separated" />
          <TextField label="Interests" value={interests} onChange={setInterests} placeholder="Comma separated, e.g. flooding, birds" />
          <Muted>Used to put bounties that fit you first. You can change this later in Account.</Muted>
        </Section>

        <View style={{ gap: S.md }}>
          {err ? <StatusPill tone="bad" text={err} /> : null}
          <Button title="Continue" icon="arrow-right" onPress={() => void finish()} loading={saving} />
        </View>
      </ScrollView>
    </View>
  );
}

function PermRow({ icon, label, detail, state }: { icon: IconName; label: string; detail: string; state: Perm }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, minHeight: TOUCH }}>
      <Icon name={icon} size={20} color={C.text} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: T.body }}>{label}</Text>
        <Muted>{detail}</Muted>
      </View>
      <StatusPill tone={state === "granted" ? "ok" : state === "denied" ? "bad" : "neutral"} text={state === "granted" ? "Allowed" : state === "denied" ? "Denied" : "Not yet"} />
    </View>
  );
}

