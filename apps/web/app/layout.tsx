import type { ReactNode } from "react";

export const metadata = { title: "GroundTruth", description: "A bounty board for reality." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
