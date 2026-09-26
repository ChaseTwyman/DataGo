import { Text, View } from "react-native";
import { Icon } from "../ui/components";
import { C, F, S, T } from "../ui/theme";
import { matchReasonText } from "./messageView";

/** "Good fit: …" line for bounty cards and the briefing. Renders nothing without a reason. */
export function MatchReason({ reason, emphasis = false }: { reason: string | null | undefined; emphasis?: boolean }) {
  const text = matchReasonText(reason);
  if (!text) return null;
  return (
    <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }} accessible accessibilityLabel={text}>
      <Icon name="user-check" size={15} color={emphasis ? C.green : C.muted} style={{ marginTop: 3 }} />
      <Text style={{ color: emphasis ? C.text : C.muted, fontFamily: emphasis ? F.bodyMedium : F.body, fontSize: T.bodySmall, lineHeight: 21, flex: 1 }}>{text}</Text>
    </View>
  );
}
