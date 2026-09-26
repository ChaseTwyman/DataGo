/**
 * Adopts the UIKit scene-based life cycle, which the iOS 27 SDK (Xcode 27) requires: apps built
 * without it abort at launch with "UIScene life cycle is required for apps built with this SDK".
 *
 * Expo SDK 57 ships `ExpoAppSceneDelegate` (objc name EXExpoAppSceneDelegate) but its prebuild
 * template (expo-template-bare-minimum 57.0.27) still starts React Native from the app delegate
 * into a window it creates itself. This plugin:
 *   1. declares the scene manifest in Info.plist, pointing at EXExpoAppSceneDelegate;
 *   2. makes AppDelegate conform to ExpoReactNativeFactoryProvider (it already has the `window`
 *      and `reactNativeFactory` properties the protocol needs);
 *   3. removes the app delegate's own window + startReactNative block, because the scene delegate
 *      now creates the window and starts React Native in scene(_:willConnectTo:options:).
 *
 * Fails the prebuild loudly if the template text changed, rather than producing an app that
 * silently starts React Native twice or never.
 */
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const CLASS_DECL = "class AppDelegate: ExpoAppDelegate {";
const CLASS_DECL_NEW = "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";
// The template's window creation + startReactNative, inside #if os(iOS) || os(tvOS) ... #endif.
const START_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function patchAppDelegate(src) {
  if (src.includes("ExpoReactNativeFactoryProvider")) return src; // already patched
  if (!src.includes(CLASS_DECL) || !START_BLOCK.test(src)) {
    throw new Error(
      "withSceneLifecycle: AppDelegate.swift does not match the Expo SDK 57 template; update the plugin.",
    );
  }
  return src
    .replace(CLASS_DECL, CLASS_DECL_NEW)
    .replace(
      START_BLOCK,
      "\n    // Scene life cycle: EXExpoAppSceneDelegate creates the window and starts React Native.\n",
    );
}

const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "EXExpoAppSceneDelegate",
          },
        ],
      },
    };
    return c;
  });
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      throw new Error("withSceneLifecycle: expected a Swift AppDelegate");
    }
    c.modResults.contents = patchAppDelegate(c.modResults.contents);
    return c;
  });
  return config;
};

module.exports = withSceneLifecycle;
module.exports.patchAppDelegate = patchAppDelegate;
