/**
 * Layers 2–4 share ONE grok-4.7 call with every burst frame (BUILD_PROMPT §6 M3). This builds the
 * memoised accessor; if the call fails, each stage that awaits it errors → needs_review.
 */
import type { VerificationOutput } from "@groundtruth/shared";
import { toModelFrame } from "../../image/modelFrame";
import type { PipelineDeps, PipelineInput } from "../types";

export function modelAccessor(input: PipelineInput, deps: PipelineDeps): () => Promise<VerificationOutput> {
  let p: Promise<VerificationOutput> | null = null;
  return () => {
    if (!p) {
      const raw = input.frames.filter((f) => f.bytes).map((f) => f.bytes!);
      p =
        raw.length === 0
          ? Promise.reject(new Error("No frames available for verification"))
          : Promise.all(raw.map((b) => toModelFrame(b))).then((resized) =>
              deps.verify({
                protocol: input.protocol,
                challenge: input.challenge,
                framesBase64: resized.map((b) => b.toString("base64")),
                intervalMs: input.protocol.capture.frame_interval_ms,
                ...(input.mockVariant ? { variant: input.mockVariant } : {}),
              }),
            );
      p.catch(() => undefined); // observed by each awaiting stage
    }
    return p;
  };
}
