/**
 * Fonts loaded at startup (JS-only: expo-font's native module ships with `expo`, and these TTFs are
 * bundled assets, so a JS reload picks them up without a native rebuild).
 * Barlow + Barlow Condensed: SIL Open Font License 1.1. Only the weights we use are imported so
 * the bundle does not carry all 18 cuts of each family.
 */
import Feather from "@expo/vector-icons/Feather";
import { Barlow_400Regular } from "@expo-google-fonts/barlow/400Regular";
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium";
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold";
import { BarlowCondensed_300Light } from "@expo-google-fonts/barlow-condensed/300Light";
import { BarlowCondensed_400Regular } from "@expo-google-fonts/barlow-condensed/400Regular";
import { BarlowCondensed_500Medium } from "@expo-google-fonts/barlow-condensed/500Medium";
import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold";
import { useFonts } from "expo-font";

const FONT_MAP = {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  BarlowCondensed_300Light,
  BarlowCondensed_400Regular,
  BarlowCondensed_500Medium,
  BarlowCondensed_600SemiBold,
  ...Feather.font,
};

/** True once fonts are ready, or once loading failed (we then fall back to the system font). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_MAP);
  return loaded || !!error;
}
