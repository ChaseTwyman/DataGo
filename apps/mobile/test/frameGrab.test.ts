import { describe, expect, it, vi } from "vitest";
import { grabFramePath, type FrameSource } from "../src/capture/frameGrab";

function fakes() {
  const dispose = vi.fn();
  const capturePhoto = vi.fn(async () => ({ saveToTemporaryFileAsync: async () => "/tmp/photo.jpg", dispose }));
  // Mirrors VisionCamera 5 iOS: HybridPreviewView.takeSnapshot always throws.
  const takeSnapshot = vi.fn(async () => {
    throw new Error("takeSnapshot() is not available on iOS!");
  });
  const src = { camera: { takeSnapshot }, photoOutput: { capturePhoto } } as unknown as FrameSource;
  return { src, capturePhoto, takeSnapshot, dispose };
}

describe("grabFramePath", () => {
  it("iOS never calls takeSnapshot; takes a silent, flash-off photo and disposes it", async () => {
    const f = fakes();
    await expect(grabFramePath(f.src, "ios")).resolves.toBe("/tmp/photo.jpg");
    expect(f.takeSnapshot).not.toHaveBeenCalled();
    expect(f.capturePhoto).toHaveBeenCalledWith({ enableShutterSound: false, flashMode: "off" }, {});
    expect(f.dispose).toHaveBeenCalledOnce();
  });

  it("disposes the photo even when saving fails", async () => {
    const f = fakes();
    f.capturePhoto.mockResolvedValueOnce({
      saveToTemporaryFileAsync: async () => {
        throw new Error("disk full");
      },
      dispose: f.dispose,
    });
    await expect(grabFramePath(f.src, "ios")).rejects.toThrow("disk full");
    expect(f.dispose).toHaveBeenCalledOnce();
  });

  it("Android uses the preview snapshot (no photo)", async () => {
    const f = fakes();
    f.takeSnapshot.mockResolvedValueOnce({ saveToTemporaryFileAsync: async () => "/tmp/snap.jpg" } as never);
    await expect(grabFramePath(f.src, "android")).resolves.toBe("/tmp/snap.jpg");
    expect(f.capturePhoto).not.toHaveBeenCalled();
  });

  it("Android falls back to a photo before the preview view mounts", async () => {
    const f = fakes();
    await expect(grabFramePath({ ...f.src, camera: null }, "android")).resolves.toBe("/tmp/photo.jpg");
  });
});
