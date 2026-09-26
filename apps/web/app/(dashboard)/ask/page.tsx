"use client";
import { useState } from "react";
import { PageHeader } from "@/components/ds/primitives";
import { AskPanel } from "@/components/openData/AskPanel";
import { Select } from "@/components/ui/form";
import { ErrorBox } from "@/components/page";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/useApi";

/**
 * Ask the data (researchers): plain-English questions over the published, coarsened observations.
 * Optionally scoped to one of your own requests, which also unlocks coverage vs target.
 */
export default function AskPage() {
  const list = useApi(() => api.bounties(), "bounties");
  const [bountyId, setBountyId] = useState("");
  const bounties = list.data?.bounties ?? [];
  const scoped = bounties.find((b) => b.id === bountyId) ?? null;
  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Ask the data"
        description="Questions about the open dataset, answered from the same privacy-coarsened rows anyone can download — with the query plan, a chart and a citable methods note."
        actions={
          <Select value={bountyId} onChange={(e) => setBountyId(e.target.value)} className="w-72" aria-label="Scope">
            <option value="">All published data</option>
            {bounties.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </Select>
        }
      />
      <div className="space-y-4 p-6">
        <ErrorBox message={list.error} />
        <AskPanel
          key={bountyId || "all"}
          mode="researcher"
          {...(scoped ? { bountyId: scoped.id, dataset: scoped.protocol_slug } : {})}
        />
      </div>
    </>
  );
}
