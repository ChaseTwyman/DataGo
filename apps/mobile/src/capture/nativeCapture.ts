/**
 * Native side of the burst + upload: VisionCamera v5 photo output, raw JPEG PUT to the signed
 * upload URLs (expo-file-system BINARY_CONTENT), device info.
 */
import type { DeviceInfo, SignedUpload } from "@groundtruth/shared";
import Constants from "expo-constants";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Device from "expo-device";
import { File, UploadType } from "expo-file-system";
import { Platform } from "react-native";
import type { CameraPhotoOutput } from "react-native-vision-camera";
import { uploadResize, type CapturedFrame } from "./burst";
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

/**
 * Shrink a burst frame for upload (after the burst, so frame timing is unaffected). Re-encoding also
 * drops the embedded EXIF/GPS; the metadata the server needs travels in the submission JSON. On any
 * failure the original frame is kept.
 */
export async function shrinkForUpload(f: CapturedFrame): Promise<CapturedFrame> {
  try {
    const full = await ImageManipulator.manipulate(f.uri).renderAsync();
    const target = uploadResize(full.width, full.height);
    if (!target) return f;
    const ctx = ImageManipulator.manipulate(full);
    ctx.resize(target);
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return {
      ...f,
      uri: out.uri,
      width: out.width,
      height: out.height,
      exif: {
        ...f.exif,
        // Pixels are now upright (the manipulator bakes the capture orientation in).
        capture_orientation: f.exif.orientation,
        orientation: "up",
        width: out.width,
        height: out.height,
        upload_long_edge: Math.max(out.width, out.height),
      },
    };
  } catch {
    return f;
  }
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
