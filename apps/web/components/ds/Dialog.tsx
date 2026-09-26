"use client";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { Button } from "../ui/button";
import { Input } from "../ui/form";

/**
 * Modal dialog on the native <dialog> element: showModal() gives focus containment, Escape to close
 * and inert background for free. Closing by Escape or backdrop click calls onClose.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-sm border bg-popover p-0 text-popover-foreground shadow-lg backdrop:bg-black/75 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="caps text-sm font-semibold">
                {title}
              </h2>
              {description ? (
                <div id={descId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {children ? <div className="px-5 py-4 text-sm">{children}</div> : null}
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button as destructive. */
  tone?: "default" | "danger";
  /** Typed-confirm variant: the confirm button stays disabled until this exact word is typed. */
  typed?: string;
}

/** Confirmation dialog. Resolves through onResult(true|false). */
export function ConfirmDialog({ options, onResult }: { options: ConfirmOptions | null; onResult: (ok: boolean) => void }) {
  const [text, setText] = useState("");
  const inputId = useId();
  useEffect(() => setText(""), [options]);
  const o = options;
  const blocked = Boolean(o?.typed) && text !== o?.typed;
  return (
    <Dialog
      open={o !== null}
      onClose={() => onResult(false)}
      title={o?.title ?? ""}
      description={o?.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResult(false)}>
            {o?.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant={o?.tone === "danger" ? "destructive" : "default"} disabled={blocked} onClick={() => onResult(true)} autoFocus={!o?.typed}>
            {o?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {o?.typed ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) onResult(true);
          }}
          className="space-y-1.5"
        >
          <label htmlFor={inputId} className="caps text-[11px] text-muted-foreground">
            Type <span className="font-mono text-foreground normal-case tracking-normal">{o.typed}</span> to confirm
          </label>
          <Input id={inputId} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoFocus />
        </form>
      ) : null}
    </Dialog>
  );
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Mount once (dashboard shell); pages call `useConfirm()` instead of window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        options={pending?.options ?? null}
        onResult={(ok) => {
          pending?.resolve(ok);
          setPending(null);
        }}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * `const confirm = useConfirm(); if (!(await confirm({ title: "…" }))) return;`
 * Outside a ConfirmProvider it falls back to window.confirm so the question is never skipped.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? ((o) => Promise.resolve(window.confirm([o.title, typeof o.body === "string" ? o.body : ""].filter(Boolean).join("\n\n"))));
}
