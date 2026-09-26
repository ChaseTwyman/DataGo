import type { ConfigContext, ExpoConfig } from "expo/config";

const CAMERA =
  "GroundTruth uses the camera to capture research observations (live preview and a 3-photo burst). Photos are only taken inside the app; nothing is imported from your library.";
const MIC =
  "GroundTruth uses the microphone so the voice field guide can hear you hands-free during capture.";
const LOCATION =
  "GroundTruth uses your location while the app is open to show nearby bounties and confirm a capture is inside the bounty area.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "GroundTruth",
  slug: "groundtruth",
  scheme: "groundtruth",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#0B0F14",
  ios: {
    bundleIdentifier: "dev.groundtruth.app",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: CAMERA,
      NSMicrophoneUsageDescription: MIC,
      NSLocationWhenInUseUsageDescription: LOCATION,
      NSMotionUsageDescription: "GroundTruth checks that the phone is level and steady before capture.",
      // Dev builds talk to the laptop API over plain HTTP on the LAN.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: "GroundTruth connects to the development server on your local network.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "dev.groundtruth.app",
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
    "expo-router",
    "expo-dev-client",
    "expo-status-bar",
    "expo-secure-store",
    [
      "expo-location",
      { locationWhenInUsePermission: LOCATION, isIosBackgroundLocationEnabled: false, isAndroidBackgroundLocationEnabled: false },
    ],
    ["expo-sensors", { motionPermission: "GroundTruth checks that the phone is level and steady before capture." }],
    ["expo-notifications", {}],
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
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? null,
  },
});
