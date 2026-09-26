import type { Metadata } from "next";
import { PublicFundingPage } from "@/components/funding/PublicFundingPage";

export const metadata: Metadata = {
  title: "Funding",
  description: "Who sponsors GroundTruth's open data and where the sponsor pool stands. No login.",
};

/** Public, no login, outside the dashboard layout. */
export default function Page() {
  return <PublicFundingPage />;
}
