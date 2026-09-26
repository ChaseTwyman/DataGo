/**
 * Native side of the burst + upload: VisionCamera v5 photo output, raw JPEG PUT to the signed
 * upload URLs (expo-file-system BINARY_CONTENT), device info.
 */
import type { DeviceInfo, SignedUpload } from "@groundtruth/shared";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { File, UploadType } from "expo-file-system";
import { Platform } from "react-native";
import type { CameraPhotoOutput } from "react-native-vision-camera";
import type { CapturedFrame } from "./burst";
import { UploadError } from "./upload";

const toFileUri = (p: string) => (p.includes("://") ? p : `file://${p}`);

export function photoCapturer(output: CameraPhotoOutput) {
  return async (): Promise<CapturedFrame> => {
    const photo = await output.capturePhoto({ enableShutterSound: false, flashMode: "off" }, {});
    try {
      const path = await photo.saveToTemporaryFileAsync();
      return {
        uri: toFileUri(path),
        width: photo.width,
        height: photo.height,
        capturedAt: new Date().toISOString(),
        // VisionCamera v5 does not expose EXIF to JS yet; the full EXIF stays inside the JPEG.
        exif: {
          source: "react-native-vision-camera@5",
          container: photo.containerFormat,
          orientation: photo.orientation,
          mirrored: photo.isMirrored,
          sensor_timestamp: photo.timestamp,
          width: photo.width,
          height: photo.height,
        },
      };
    } finally {
      photo.dispose();
    }
  };
}

export async function uploadJpeg(uri: string, target: SignedUpload): Promise<void> {
  const file = new File(uri);
  let res: { status: number; body: string };
  try {
    res = await file.upload(target.signed_url, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      headers: { "Content-Type": "image/jpeg" },
    });
  } catch (e) {
    // Transport failure (offline, dropped connection): status 0 → retryable.
    throw new UploadError(0, e instanceof Error ? e.message : "");
  }
  if (res.status < 200 || res.status >= 300) throw new UploadError(res.status, (res.body ?? "").slice(0, 200));
}

export function deviceInfo(): DeviceInfo {
  return {
    model: Device.modelName ?? null,
    os: Device.osName ?? Platform.OS,
    os_version: Device.osVersion ?? null,
    app_version: Constants.expoConfig?.version ?? null,
  };
}
