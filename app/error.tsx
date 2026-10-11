'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="boot">
      <h1>Let’s take that again.</h1>
      <p>Something interrupted this page.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
