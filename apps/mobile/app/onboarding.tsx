/**
 * Onboarding (PRD §7.1): permissions (camera, mic, location while using), 18+ gate, data-license
 * consent, and the MVP profile form (voice interview is P1).
 */
import * as Location from "expo-location";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AudioManager } from "react-native-audio-api";
import { useCameraPermission } from "react-native-vision-camera";
import { api } from "../src/api";
import { useApp } from "../src/state/appStore";
import { Button, Card, H, Muted, StatusPill } from "../src/ui/components";
import { C, S, TOUCH } from "../src/ui/theme";

type Perm = "unknown" | "granted" | "denied";

export default function Onboarding() {
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

  const askAll = async () => {
    await cam.requestPermission();
    setMic((await AudioManager.requestRecordingPermissions()) === "Granted" ? "granted" : "denied");
    setLoc((await Location.requestForegroundPermissionsAsync()).status === "granted" ? "granted" : "denied");
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const permsOk = cam.hasPermission && mic === "granted" && loc === "granted";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingTop: 72, gap: S.lg }}>
      <H size={30}>GroundTruth</H>
      <Muted>Get paid to capture verified, research-grade observations of the world around you. A voice guide coaches you, hands-free.</Muted>

      <Card style={{ gap: S.sm }}>
        <H size={17}>1 · Permissions</H>
        <PermRow label="Camera (in-app capture only)" state={cam.hasPermission ? "granted" : cam.canRequestPermission ? "unknown" : "denied"} />
        <PermRow label="Microphone (voice guide)" state={mic} />
        <PermRow label="Location, only while using the app" state={loc} />
        <Button title={permsOk ? "All set" : "Allow access"} kind={permsOk ? "secondary" : "primary"} onPress={() => void askAll()} disabled={permsOk} />
      </Card>

      <Card style={{ gap: S.sm }}>
        <H size={17}>2 · Eligibility and license</H>
        <Check checked={adult} onToggle={() => setAdult((v) => !v)} label="I am 18 or older (required for paid bounties)." />
        <Check
          checked={consent}
          onToggle={() => setConsent((v) => !v)}
          label="I license my accepted observations under CC BY 4.0 (“GroundTruth contributors”). Raw images stay private to approved researchers."
        />
      </Card>

      <Card style={{ gap: S.sm }}>
        <H size={17}>3 · About you (optional)</H>
        <Field value={name} onChange={setName} placeholder="Display name" />
        <Field value={occupation} onChange={setOccupation} placeholder="Occupation (e.g. civil engineer)" />
        <Field value={skills} onChange={setSkills} placeholder="Skills, comma separated" />
        <Muted>Used to match you with bounties. Voice interview coming soon.</Muted>
      </Card>

      {err ? <StatusPill tone="bad" text={err} /> : null}
      <Button title="Continue" onPress={() => void finish()} disabled={!adult || !consent} loading={saving} />
      {!adult || !consent ? <Muted style={{ textAlign: "center" }}>Confirm age and license to continue.</Muted> : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function PermRow({ label, state }: { label: string; state: Perm }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 }}>
      <Text style={{ color: C.text, flex: 1 }}>{label}</Text>
      <StatusPill tone={state === "granted" ? "ok" : state === "denied" ? "bad" : "neutral"} text={state === "granted" ? "Allowed" : state === "denied" ? "Denied" : "Not yet"} />
    </View>
  );
}

function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={{ flexDirection: "row", gap: S.md, alignItems: "center", minHeight: TOUCH }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? C.green : C.muted,
          backgroundColor: checked ? C.green : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: C.bg, fontWeight: "900" }}>✓</Text> : null}
      </View>
      <Text style={{ color: C.text, flex: 1, fontSize: 15, lineHeight: 21 }}>{label}</Text>
    </Pressable>
  );
}

function Field({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      style={{ minHeight: TOUCH, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: S.md }}
    />
  );
}
