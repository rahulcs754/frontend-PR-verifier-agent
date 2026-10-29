import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'PreviewPilot',
  description: 'Past PreviewPilot runs: what changed and what broke on each PR preview.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="topbar">
            <Link href="/" className="brand">
              PreviewPilot <span>runs</span>
            </Link>
            <a className="small" href="https://github.com/rahulcs754/frontend-PR-verifier-agent">
              GitHub
            </a>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
