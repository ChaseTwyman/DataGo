"use client";
import { SegmentError } from "@/components/ErrorState";

/** Any render crash inside the dashboard: calm panel inside the shell (sidebar stays usable). */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SegmentError error={error} retry={retry} />;
}
