import type { Metadata } from "next";
import { OpenDataPage } from "@/components/openData/OpenDataPage";

export const metadata: Metadata = {
  title: "Open data",
  description:
    "Verified street-level field observations, free for every scientist. CC BY 4.0, structured data only, no login.",
};

/** Public, no login, outside the dashboard layout. */
export default function Page() {
  return <OpenDataPage />;
}
