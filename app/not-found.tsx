import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="boot">
      <span className="eyebrow">A LITTLE OFF SCRIPT</span>
      <h1>This story isn’t here.</h1>
      <p>The page may have moved or the title is no longer available.</p>
      <Link className="button primary" href="/">
        Back to your universe
      </Link>
    </main>
  );
}
