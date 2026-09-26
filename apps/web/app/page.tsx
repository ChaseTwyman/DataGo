import { redirect } from "next/navigation";

/** The dashboard is the web app's only UI; auth is checked client-side by the dashboard shell. */
export default function Home() {
  redirect("/bounties");
}
