"use client";
import { ChevronDown, ChevronRight, Sparkles, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { LenientGrokbotMessage } from "@/lib/client/grokbot";
import { cn } from "@/lib/client/cn";
import { useGrokbot } from "@/lib/client/useGrokbot";
import { GrokbotCard } from "./GrokbotCard";

/**
 * A question the reader can ask Grok ("Why is this pending?", "Explain"). Nothing is fetched until
 * it is opened, so pages don't spend a model call per card; once opened it stays loaded.
 */
export function GrokbotAsk({
  label,
  title,
  cacheKey,
  load,
  icon = Sparkles,
  defaultOpen = false,
  className,
  cardClassName,
}: {
  label: ReactNode;
  title: ReactNode;
  cacheKey: string;
  load: (refresh: boolean) => Promise<LenientGrokbotMessage>;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  className?: string;
  cardClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(defaultOpen);
  const g = useGrokbot(load, cacheKey, opened);
  const panelId = useId();
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
          setOpened(true);
        }}
        className="caps inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <Sparkles className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden />
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
      <div id={panelId} hidden={!open}>
        {opened ? (
          <GrokbotCard
            className={cn("mt-2", cardClassName)}
            title={title}
            icon={icon}
            message={g.data}
            loading={g.loading}
            error={g.error}
            onRegenerate={() => void g.load(true)}
          />
        ) : null}
      </div>
    </div>
  );
}
