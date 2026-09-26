import type { Metadata } from "next";
import { SegmentNotFound } from "@/components/ErrorState";

export const metadata: Metadata = { title: "Not found" };

/** Unmatched URLs anywhere. The open data page is the public front door, so link there. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen">
      <SegmentNotFound home="/data" homeLabel="Go to open data" />
    </main>
  );
}
