"use client";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/client/cn";

/** Read-only JSON/code block with a caps title bar and a copy button. */
export function CodeBlock({
  code,
  title,
  className,
  maxHeight = 420,
}: {
  code: string;
  title?: string;
  className?: string;
  maxHeight?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className={cn("rounded-sm border bg-background", className)}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="caps text-[10px] text-muted-foreground">{title ?? "JSON"}</span>
        <button type="button" onClick={copy} className="caps inline-flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground/80" style={{ maxHeight }}>
        {code}
      </pre>
    </div>
  );
}

export function JsonViewer({ value, title, className, maxHeight }: { value: unknown; title?: string; className?: string; maxHeight?: number }) {
  const code = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? "null";
    } catch {
      return String(value);
    }
  }, [value]);
  return <CodeBlock code={code} title={title} className={className} maxHeight={maxHeight} />;
}
