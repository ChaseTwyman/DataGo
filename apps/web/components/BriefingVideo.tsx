"use client";
import { Clapperboard, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import {
  BRIEFING_POLL_MS,
  briefingTick,
  rememberBriefing,
  rememberedBriefing,
  startFailed,
  startRendering,
  videoKey,
  type BriefingState,
} from "@/lib/client/briefing";
import { cn } from "@/lib/client/cn";

/**
 * Mission briefing clip (PRD §7.3, Grok Imagine video). Always rendered with its AI-generated label.
 * Generating is async: the route answers 202, the server stores the clip minutes later, and this
 * polls the bounty until briefing_video_url points at a new clip (or gives up after ~6 minutes).
 */
export function BriefingVideo({
  bountyId,
  videoUrl,
  canManage,
  refresh,
  className,
}: {
  bountyId: string;
  videoUrl: string | null;
  canManage: boolean;
  refresh: () => Promise<void>;
  className?: string;
}) {
  const [state, setStateRaw] = useState<BriefingState>(() => rememberedBriefing(bountyId));
  const setState = (s: BriefingState) => {
    rememberBriefing(bountyId, s);
    setStateRaw(s);
  };

  // Every new bounty payload (from polling or the page's own refreshes) advances the state machine.
  useEffect(() => {
    setStateRaw((s) => {
      const next = briefingTick(s, videoUrl, Date.now());
      rememberBriefing(bountyId, next);
      return next;
    });
  }, [videoUrl, bountyId]);

  const rendering = state.phase === "rendering" || state.phase === "starting";
  useEffect(() => {
    if (state.phase !== "rendering") return;
    const t = setInterval(() => {
      void refresh();
      // Timeout also has to fire when the URL never changes.
      setStateRaw((s) => {
        const next = briefingTick(s, videoUrl, Date.now());
        rememberBriefing(bountyId, next);
        return next;
      });
    }, BRIEFING_POLL_MS);
    return () => clearInterval(t);
  }, [state.phase, refresh, videoUrl, bountyId]);

  const generate = async () => {
    setState({ phase: "starting" });
    try {
      await api.briefingVideo(bountyId);
      setState(startRendering(videoUrl, Date.now()));
    } catch (e) {
      setState(startFailed(e));
    }
  };

  // Signed URLs get a fresh token on every bounty fetch; keep the first one per stored clip so a
  // refresh doesn't reload a playing video.
  // (State adjusted during render — React's documented pattern for deriving from a prop; a ref write
  // here would break under concurrent rendering.)
  const [stableSrc, setStableSrc] = useState(videoUrl);
  if (videoKey(videoUrl) !== videoKey(stableSrc)) setStableSrc(videoUrl);

  if (!videoUrl && !canManage) return null;

  return (
    <div data-theme="dark" className={cn("space-y-2 rounded-sm border bg-black/80 p-2 text-foreground backdrop-blur-sm", className)}>
      {videoUrl ? (
        <figure className="relative overflow-hidden rounded-sm bg-black">
          <video
            key={videoKey(videoUrl) ?? videoUrl}
            src={stableSrc ?? videoUrl}
            controls
            playsInline
            muted
            loop
            preload="metadata"
            className="block aspect-[9/16] w-full object-cover"
            aria-label="AI-generated mission briefing clip"
          />
          <figcaption className="caps pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-[2px] bg-white px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-black">
            <Sparkles className="size-3" aria-hidden />
            AI-generated briefing
          </figcaption>
        </figure>
      ) : (
        <div className="caps flex items-center gap-1.5 px-1 pt-1 text-[11px] font-semibold">
          <Clapperboard className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden /> Briefing clip
        </div>
      )}

      {state.phase === "rendering" ? (
        <p role="status" className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
          <LoaderCircle className="mt-0.5 size-3 shrink-0 animate-spin" aria-hidden />
          <span>
            Rendering a 7 s clip with Grok Imagine — usually a few minutes. You can leave this page.
            {videoUrl ? " The current clip stays until the new one is ready." : ""}
          </span>
        </p>
      ) : null}
      {state.phase === "timeout" ? <p className="px-1 text-[11px] text-warning">Still rendering — check back later.</p> : null}
      {state.phase === "ready" ? <p className="px-1 text-[11px] text-success">New briefing clip ready.</p> : null}
      {state.phase === "error" ? <ErrorBox message={state.message} className="px-2 py-1.5 text-xs" /> : null}
      {!videoUrl && state.phase === "idle" ? (
        <p className="px-1 text-[11px] text-muted-foreground">A short AI-generated clip contributors see before they capture.</p>
      ) : null}

      {canManage ? (
        <Button size="sm" variant={videoUrl ? "outline" : "default"} className="w-full" disabled={rendering} onClick={() => void generate()}>
          {rendering ? <LoaderCircle className="animate-spin" aria-hidden /> : videoUrl ? <RefreshCw aria-hidden /> : <Clapperboard aria-hidden />}
          {state.phase === "starting" ? "Starting…" : state.phase === "rendering" ? "Rendering…" : videoUrl ? "Regenerate clip" : "Generate briefing clip"}
        </Button>
      ) : null}
    </div>
  );
}
