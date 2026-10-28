import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PreviewPilot demo",
  description: "Test target for the PreviewPilot PR verifier.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>PreviewPilot demo</strong>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
