'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { ErrorBox } from './ui';
export function ColabManager() {
  const [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <span className="eyebrow">EXTERNAL GPU</span>
      <h1>Colab rendition worker</h1>
      <p>
        Open the provided Colab script with a GPU runtime. It claims queued episodes automatically,
        downloads their sources from Yoru and returns video/audio renditions. Yoru retains
        encryption, HF uploads and final verification.
      </p>
      <p className="muted">
        Creating a key reserves future encoding jobs for Colab. The currently running local job
        finishes normally. Start the notebook immediately after creating the key; use one notebook
        at a time. Keep the notebook connected. This key grants temporary admin access to queued
        media processing for 24 hours. Keep it private. Revoking stops further requests; a Space
        restart may invalidate it.
      </p>
      {error && <ErrorBox message={error} />}
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const result = await post<{ key: string }>('/admin/colab/connect', {});
            setKey(result.key);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Create connection key
      </button>
      {key && (
        <>
          <input readOnly aria-label="Colab connection key" value={key} />
          <button className="button glass" onClick={() => navigator.clipboard.writeText(key)}>
            Copy key
          </button>
          <button
            className="button glass"
            onClick={async () => {
              try {
                await post('/admin/colab/revoke', { key });
                setKey('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Revoke key
          </button>
        </>
      )}
      <p>
        <a href="/colab-worker.py" download>
          Download Colab worker script
        </a>{' '}
        · Paste its contents into one Colab cell.
      </p>
    </section>
  );
}
