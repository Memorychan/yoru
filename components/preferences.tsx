'use client';
import { useEffect, useState } from 'react';
export function Preferences() {
  const [spoilers, setSpoilers] = useState(true);
  const [autoNext, setAutoNext] = useState(false);
  useEffect(() => {
    setSpoilers(localStorage.getItem('yoru-spoilers') !== 'false');
    setAutoNext(localStorage.getItem('yoru-autonext') === 'true');
  }, []);
  return (
    <section className="panel">
      <h2>Your viewing preferences</h2>
      <p>Saved on this device.</p>
      <div className="preference-row">
        <div>
          <strong>Spoiler-safe episodes</strong>
          <p>Hide unwatched episode names on title pages.</p>
        </div>
        <input
          aria-label="Spoiler-safe episodes"
          type="checkbox"
          checked={spoilers}
          onChange={(e) => {
            setSpoilers(e.target.checked);
            localStorage.setItem('yoru-spoilers', String(e.target.checked));
          }}
        />
      </div>
      <div className="preference-row">
        <div>
          <strong>Automatically play the next episode</strong>
          <p>Continue to the next episode when one finishes.</p>
        </div>
        <input
          aria-label="Autoplay next episode"
          type="checkbox"
          checked={autoNext}
          onChange={(e) => {
            setAutoNext(e.target.checked);
            localStorage.setItem('yoru-autonext', String(e.target.checked));
          }}
        />
      </div>
    </section>
  );
}
