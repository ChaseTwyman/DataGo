import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, Readout } from "./ds/primitives";

/**
 * Page-level helpers kept under their original names so existing pages keep importing from here.
 * They are thin aliases of the design-system primitives in components/ds.
 */
export { PageHeader };

/**
 * Inline failure notice. `message` must already be user copy — pass `errorMessage(e)`
 * (lib/client/errors.ts), never `e.message`.
 */
export function ErrorBox({ message, className, onRetry }: { message: string | null | undefined; className?: string; onRetry?: () => void }) {
  return <ErrorState message={message} className={className} onRetry={onRetry} />;
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return <LoadingState label={label} className={className} />;
}

export function Empty({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <EmptyState title={title} className={className}>
      {children}
    </EmptyState>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <Readout label={label} value={value} sub={sub} size="sm" />;
}
