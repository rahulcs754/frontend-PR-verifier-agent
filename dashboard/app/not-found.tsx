import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="card empty">
      <p>That run does not exist.</p>
      <Link href="/">Back to all runs</Link>
    </main>
  );
}
