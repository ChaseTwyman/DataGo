/** Live frame grab for the capture gate. Pure (types only) so it is unit-testable in node. */
import type { CameraPhotoOutput, CameraRef } from "react-native-vision-camera";

export interface FrameSource {
  camera: CameraRef | null;
  photoOutput: CameraPhotoOutput;
}

/**
 * Current view as a temp JPEG path. Android snapshots the preview (cheap, silent). iOS has no
 * preview snapshot in VisionCamera 5 — calling it threw on every tick, so no frame ever reached the
 * server and the checklist stayed all-missing — so iOS takes a silent photo (same call the burst uses).
 */
export async function grabFramePath(src: FrameSource, os: string): Promise<string> {
  if (os === "android" && src.camera) {
    const snap = await src.camera.takeSnapshot();
    return snap.saveToTemporaryFileAsync("jpg", 0.9);
  }
  const photo = await src.photoOutput.capturePhoto({ enableShutterSound: false, flashMode: "off" }, {});
  try {
    return await photo.saveToTemporaryFileAsync();
  } finally {
    photo.dispose();
  }
}
