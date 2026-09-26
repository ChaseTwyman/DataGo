/**
 * The iOS 27 SDK aborts apps that don't adopt the UIScene life cycle. plugins/withSceneLifecycle.js
 * patches the Expo SDK 57 template AppDelegate; this pins it against the real template file
 * (expo-template-bare-minimum 57.0.27, copied to test/fixtures).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { patchAppDelegate } = require("../plugins/withSceneLifecycle.js") as {
  patchAppDelegate: (src: string) => string;
};
const template = readFileSync(fileURLToPath(new URL("./fixtures/AppDelegate.sdk57.swift", import.meta.url)), "utf8");

describe("withSceneLifecycle", () => {
  it("conforms AppDelegate to ExpoReactNativeFactoryProvider", () => {
    expect(patchAppDelegate(template)).toContain(
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    );
  });

  it("removes the delegate's own window + startReactNative (the scene delegate does it)", () => {
    const out = patchAppDelegate(template);
    expect(template).toContain("factory.startReactNative(");
    expect(out).not.toContain("startReactNative");
    expect(out).not.toContain("UIWindow(frame:");
  });

  it("keeps the factory creation and the window/factory properties the protocol needs", () => {
    const out = patchAppDelegate(template);
    expect(out).toContain("reactNativeFactory = factory");
    expect(out).toContain("var window: UIWindow?");
    expect(out).toContain("var reactNativeFactory: RCTReactNativeFactory?");
    expect(out).toContain("return super.application(application, didFinishLaunchingWithOptions: launchOptions)");
  });

  it("is idempotent", () => {
    const once = patchAppDelegate(template);
    expect(patchAppDelegate(once)).toBe(once);
  });

  it("fails loudly on an unexpected template", () => {
    expect(() => patchAppDelegate("class Foo {}")).toThrow(/does not match/);
  });
});
