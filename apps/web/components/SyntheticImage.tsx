import { ImageOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * Every AI-generated image in the dashboard goes through this component so it can never be shown
 * without its label (PRD §13, BUILD_PROMPT M6: "always rendered with an EXAMPLE — AI-generated label").
 */
export function SyntheticImage({
  src,
  label,
  tone = "example",
  alt,
  className,
}: {
  src: string | null | undefined;
  label: string;
  tone?: "example" | "redteam";
  alt: string;
  className?: string;
}) {
  return (
    <figure className={cn("relative overflow-hidden rounded-lg border bg-muted", className)}>
      {src ? (
        <img src={src} alt={alt} className="block h-full w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" aria-hidden />
        </div>
      )}
      <figcaption
        className={cn(
          "absolute top-2 left-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold tracking-wide text-white uppercase shadow",
          tone === "redteam" ? "bg-red-600" : "bg-violet-600",
        )}
      >
        <Sparkles className="size-3" aria-hidden />
        {label}
      </figcaption>
    </figure>
  );
}
