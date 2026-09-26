"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { BountyListItem } from "@groundtruth/shared";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/useApi";
import { Select } from "./ui/form";

/**
 * Selected bounty lives in `?bounty=` so pages are linkable from the bounty page. Defaults to the
 * first active bounty.
 */
export function useSelectedBounty(): {
  bounties: BountyListItem[];
  selected: BountyListItem | null;
  select: (id: string) => void;
  loading: boolean;
  error: string | null;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const list = useApi(() => api.bounties(), "bounties");
  const bounties = list.data?.bounties ?? [];
  const wanted = params.get("bounty");
  const selected =
    bounties.find((b) => b.id === wanted) ?? (wanted ? null : (bounties.find((b) => b.status === "active") ?? bounties[0] ?? null));

  const select = (id: string) => router.replace(`${pathname}?bounty=${encodeURIComponent(id)}`);

  useEffect(() => {
    if (!wanted && selected) router.replace(`${pathname}?bounty=${selected.id}`);
  }, [wanted, selected, pathname, router]);

  return { bounties, selected, select, loading: list.loading, error: list.error };
}

export function BountySelect({
  bounties,
  value,
  onChange,
}: {
  bounties: BountyListItem[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="w-72" aria-label="Bounty">
      {!value ? <option value="">Select a bounty…</option> : null}
      {bounties.map((b) => (
        <option key={b.id} value={b.id}>
          {b.title} ({b.status})
        </option>
      ))}
    </Select>
  );
}
