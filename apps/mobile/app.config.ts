import type { ConfigContext, ExpoConfig } from "expo/config";

const CAMERA =
  "GroundTruth uses the camera to capture research observations (live preview and a 3-photo burst). Photos are only taken inside the app; nothing is imported from your library.";
const MIC =
  "GroundTruth uses the microphone so the voice field guide can hear you hands-free during capture.";
const LOCATION =
  "GroundTruth uses your location while the app is open to show nearby bounties and confirm a capture is inside the bounty area.";

/**
 * EAS: run `eas init` in apps/mobile. Because this config is dynamic, eas init prints the project
 * id instead of writing it: paste it (and your Expo account name as owner) into the two constants
 * below and commit. The id is not a secret. Left undefined on purpose; never invent one.
 */
const PASTED_EAS_PROJECT_ID: string | undefined = undefined;
const PASTED_EAS_OWNER: string | undefined = undefined;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || PASTED_EAS_PROJECT_ID;
const EAS_OWNER = process.env.EAS_OWNER || PASTED_EAS_OWNER;

/** A free Personal Team may need a globally unique id: IOS_BUNDLE_ID=com.yourname.groundtruth. */
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || "dev.groundtruth.app";
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || "dev.groundtruth.app";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "GroundTruth",
  slug: "groundtruth",
  ...(EAS_OWNER ? { owner: EAS_OWNER } : {}),
  scheme: "groundtruth",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#0B0F14",
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: CAMERA,
      NSMicrophoneUsageDescription: MIC,
      NSLocationWhenInUseUsageDescription: LOCATION,
      NSMotionUsageDescription: "GroundTruth checks that the phone is level and steady before capture.",
      // Dev builds load JS from Metro (LAN IP or an `expo start --tunnel` http URL) and talk to the
      // laptop API over plain HTTP. Do NOT add NSAllowsLocalNetworking here: when it is present iOS
      // ignores NSAllowsArbitraryLoads, which blocked the http://*.exp.direct tunnel bundle
      // ("App Transport Security policy requires the use of a secure connection", -1022).
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription: "GroundTruth connects to the development server on your local network.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ],
    blockedPermissions: ["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_EXTERNAL_STORAGE"],
  },
  plugins: [
    // iOS 27 SDK requires the UIScene life cycle; see plugins/withSceneLifecycle.js.
    "./plugins/withSceneLifecycle",
    "expo-router",
    "expo-dev-client",
    "expo-status-bar",
    "expo-secure-store",
    [
      "expo-location",
      { locationWhenInUsePermission: LOCATION, isIosBackgroundLocationEnabled: false, isAndroidBackgroundLocationEnabled: false },
    ],
    ["expo-sensors", { motionPermission: "GroundTruth checks that the phone is level and steady before capture." }],
    // No expo-notifications: installing it auto-applies a plugin that adds the aps-environment
    // (push) entitlement, which a free Apple ID "Personal Team" cannot sign. P1 local
    // notifications would re-add it with a plugin that strips that entitlement.
    [
      "react-native-audio-api",
      {
        iosMicrophonePermission: MIC,
        // Voice runs only while the capture screen is open; no background audio.
        iosBackgroundMode: false,
        androidForegroundService: false,
        androidPermissions: ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"],
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? null,
    ...(EAS_PROJECT_ID ? { eas: { ...(config.extra?.eas as object | undefined), projectId: EAS_PROJECT_ID } } : {}),
  },
});
