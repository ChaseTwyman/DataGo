import type { Metadata } from "next";
import { PublicSponsorImpactPage } from "@/components/funding/PublicSponsorImpactPage";

export const metadata: Metadata = {
  title: "Sponsor impact",
  description: "What a GroundTruth sponsor's contributions paid for. Aggregates only, no login.",
};

/** Public, no login, outside the dashboard layout. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicSponsorImpactPage sponsorId={id} />;
}
