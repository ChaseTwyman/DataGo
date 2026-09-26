/**
 * Layers 2–4 share ONE grok-4.7 call with every burst frame (BUILD_PROMPT §6 M3). This builds the
 * memoised accessor; if the call fails, each stage that awaits it errors → needs_review.
 *
 * The pipeline starts the call early (concurrently with the fast relevance screen) and can abort it:
 * when relevance rejects a capture as off-topic the in-flight request is cancelled, so the wasted
 * cost is bounded by the ~2 s it ran.
 */
import type { VerificationOutput } from "@groundtruth/shared";
import { grokEnv } from "../../grok/config";
import { toModelFrame } from "../../image/modelFrame";
import type { PipelineDeps, PipelineInput } from "../types";

export interface ModelAccessor {
  (): Promise<VerificationOutput>;
  /** Cancels the in-flight call (if started); awaiting stages then see a rejection. */
  abort(reason: string): void;
}

export function modelAccessor(input: PipelineInput, deps: PipelineDeps): ModelAccessor {
  let p: Promise<VerificationOutput> | null = null;
  const controller = new AbortController();
  const get = (() => {
    if (!p) {
      const raw = input.frames.filter((f) => f.bytes).map((f) => f.bytes!);
      const maxEdge = grokEnv.verificationFrameMaxEdge;
      p =
        raw.length === 0
          ? Promise.reject(new Error("No frames available for verification"))
          : Promise.all(raw.map((b) => toModelFrame(b, maxEdge))).then((resized) => {
              if (controller.signal.aborted) throw new Error(String(controller.signal.reason ?? "aborted"));
              return deps.verify({
                protocol: input.protocol,
                challenge: input.challenge,
                framesBase64: resized.map((b) => b.toString("base64")),
                intervalMs: input.protocol.capture.frame_interval_ms,
                signal: controller.signal,
                ...(input.mockVariant ? { variant: input.mockVariant } : {}),
              });
            });
      p.catch(() => undefined); // observed by each awaiting stage
    }
    return p;
  }) as ModelAccessor;
  get.abort = (reason: string) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  return get;
}
