/**
 * Onboarding (PRD §7.1): permissions (camera, mic, location while using), 18+ gate, data-license
 * consent, and the MVP profile form (voice interview is P1).
 */
import * as Location from "expo-location";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AudioManager } from "react-native-audio-api";
import { useCameraPermission } from "react-native-vision-camera";
import { api } from "../src/api";
import { toUserMessage } from "../src/api/errors";
import { log } from "../src/lib/log";
import { useApp } from "../src/state/appStore";
import { Body, Button, Divider, Heading, Icon, Label, Muted, Section, StatusPill, type IconName } from "../src/ui/components";
import { C, F, R, S, T, TOUCH } from "../src/ui/theme";

type Perm = "unknown" | "granted" | "denied";

const MARK = require("../assets/splash-icon.png") as number;

export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/ErrorFallback";

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const cam = useCameraPermission();
  const [mic, setMic] = useState<Perm>("unknown");
  const [loc, setLoc] = useState<Perm>("unknown");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [occupation, setOccupation] = useState("");
  const [skills, setSkills] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setOnboarded = useApp((s) => s.setOnboarded);

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
      await api.profile({
        is_adult: adult,
        consent_license: consent,
        ...(name.trim() ? { display_name: name.trim() } : {}),
        ...(occupation.trim() ? { occupation: occupation.trim() } : {}),
        ...(skills.trim() ? { skills: skills.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30) } : {}),
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
  const ready = adult && consent;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: insets.top + S.xl, gap: S.xxl, paddingBottom: S.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: S.lg }}>
          <Image source={MARK} style={{ width: 56, height: 56 }} accessibilityIgnoresInvertColors accessibilityLabel="GroundTruth mark" />
          <Heading size={T.hero}>GroundTruth</Heading>
          <Body color={C.muted}>Get paid to capture verified, research-grade observations of the world around you. A voice guide coaches you, hands-free.</Body>
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

        <Section index={1} title="Eligibility and license">
          <Check checked={adult} onToggle={() => setAdult((v) => !v)} label="I am 18 or older (required for paid bounties)." />
          <Divider />
          <Check
            checked={consent}
            onToggle={() => setConsent((v) => !v)}
            label="I license my accepted observations under CC BY 4.0 (“GroundTruth contributors”). Raw images stay private to approved researchers."
          />
        </Section>

        <Section index={2} title="About you" right={<Label>Optional</Label>}>
          <Field label="Display name" value={name} onChange={setName} placeholder="e.g. Sam" />
          <Field label="Occupation" value={occupation} onChange={setOccupation} placeholder="e.g. civil engineer" />
          <Field label="Skills" value={skills} onChange={setSkills} placeholder="Comma separated" />
          <Muted>Used to match you with bounties. Voice interview coming soon.</Muted>
        </Section>

        <View style={{ gap: S.md }}>
          {err ? <StatusPill tone="bad" text={err} /> : null}
          <Button title="Continue" icon="arrow-right" onPress={() => void finish()} disabled={!ready} loading={saving} />
          {!ready ? <Label style={{ textAlign: "center" }}>Confirm age and license to continue</Label> : null}
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

function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={{ flexDirection: "row", gap: S.md, alignItems: "center", minHeight: TOUCH + 8 }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: R.sm,
          borderWidth: 1.5,
          borderColor: checked ? C.accent : C.muted,
          backgroundColor: checked ? C.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="check" size={18} color={C.onAccent} /> : null}
      </View>
      <Body style={{ flex: 1 }}>{label}</Body>
    </Pressable>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <View style={{ gap: S.xs }}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        accessibilityLabel={label}
        style={{ minHeight: TOUCH, borderBottomWidth: 1, borderColor: C.hairline, color: C.text, fontFamily: F.body, fontSize: T.body, paddingVertical: S.sm }}
      />
    </View>
  );
}
