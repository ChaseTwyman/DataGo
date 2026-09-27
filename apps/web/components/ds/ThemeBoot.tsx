"use client";
import { useLayoutEffect } from "react";
import { applyStoredPreferences } from "./preferences";

/** Puts the stored theme and sidebar back if hydration reset the attributes the boot script set. */
export function ThemeBoot() {
  useLayoutEffect(() => {
    applyStoredPreferences();
  }, []);
  return null;
}
