/** Form controls: underlined text fields, password with show/hide, and 44 pt checkboxes. */
import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { Body, Icon, Label } from "./components";
import { C, F, R, S, T, TOUCH } from "./theme";

type FieldProps = {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  /** Already user copy (never raw error text). */
  error?: string | null;
  hint?: string;
} & Pick<TextInputProps, "autoComplete" | "textContentType" | "keyboardType" | "autoCapitalize" | "returnKeyType" | "onSubmitEditing" | "editable">;

export function FieldError({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: S.xs }} accessibilityRole="alert">
      <Icon name="alert-circle" size={14} color={C.red} />
      <Text style={{ color: C.red, fontFamily: F.bodyMedium, fontSize: T.bodySmall, flex: 1 }}>{text}</Text>
    </View>
  );
}

function Underline({ error, children }: { error?: string | null; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: TOUCH, borderBottomWidth: 1, borderColor: error ? C.red : C.hairline }}>{children}</View>
  );
}

const inputStyle = { flex: 1, minHeight: TOUCH, color: C.text, fontFamily: F.body, fontSize: T.body, paddingVertical: S.sm } as const;

export function TextField({ label, value, onChange, placeholder, error, hint, ...rest }: FieldProps) {
  return (
    <View style={{ gap: S.xs }}>
      <Label>{label}</Label>
      <Underline error={error}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.muted}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          style={inputStyle}
          {...rest}
        />
      </Underline>
      {error ? <FieldError text={error} /> : hint ? <Label>{hint}</Label> : null}
    </View>
  );
}

export function PasswordField({ label, value, onChange, placeholder, error, hint, ...rest }: FieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: S.xs }}>
      <Label>{label}</Label>
      <Underline error={error}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.muted}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
          {...rest}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? "Hide password" : "Show password"}
          onPress={() => setShown((v) => !v)}
          hitSlop={6}
          style={{ width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name={shown ? "eye-off" : "eye"} size={20} color={C.muted} />
        </Pressable>
      </Underline>
      {error ? <FieldError text={error} /> : hint ? <Label>{hint}</Label> : null}
    </View>
  );
}

export function Check({ checked, onToggle, label, error }: { checked: boolean; onToggle: () => void; label: string; error?: string | null }) {
  return (
    <View style={{ gap: S.xs }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        onPress={onToggle}
        style={{ flexDirection: "row", gap: S.md, alignItems: "center", minHeight: TOUCH + 8 }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: R.sm,
            borderWidth: 1.5,
            borderColor: checked ? C.accent : error ? C.red : C.muted,
            backgroundColor: checked ? C.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? <Icon name="check" size={18} color={C.onAccent} /> : null}
        </View>
        <Body style={{ flex: 1 }}>{label}</Body>
      </Pressable>
      {error ? <FieldError text={error} /> : null}
    </View>
  );
}
