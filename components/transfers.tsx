'use client';
import { useState, useEffect } from 'react';
import { Modal, Field, ErrorBox, useData } from './ui';
import { post } from '@/lib/api';
import type { Episode, Storage } from '@/lib/types';
export function StorageCopies({ episode, close }: { episode: Episode; close: () => void }) {
  const connections = useData<Storage[]>('/admin/storage');
  const transfers =
    useData<
      {
        id: string;
        state: string;
        progress: number;
        error: string | null;
        assetId: string;
        storage: { name: string };
      }[]
    >('/admin/transfers');
  const [destination, setDestination] = useState('');
  const [mode, setMode] = useState('REPLICATE');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(transfers.reload, 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Modal title={`Storage copies · ${episode.name}`} close={close}>
      <p className="muted">
        Copy encrypted media to another connected bucket. Verified copies are used automatically if
        the primary connection fails.
      </p>
      {(error || connections.error || transfers.error) && (
        <ErrorBox message={error || connections.error || transfers.error} />
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            await post('/admin/transfers', { episodeId: episode.id, storageId: destination, mode });
            transfers.reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Destination">
          <select value={destination} onChange={(e) => setDestination(e.target.value)} required>
            <option value="">Choose another bucket</option>
            {connections.data
              ?.filter((s) => s.enabled && s.id !== episode.asset?.storageId)
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name} · {s.bucket}
                </option>
              ))}
          </select>
        </Field>
        <Field label="After the copy">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="REPLICATE">Keep as a backup copy</option>
            <option value="MIGRATE">Use destination as primary storage</option>
          </select>
        </Field>
        <p className="muted">Existing copies are preserved. No remote files are deleted.</p>
        <button className="button primary" disabled={busy || !destination}>
          {busy ? 'Queuing…' : 'Copy encrypted media'}
        </button>
      </form>
      <div className="collection-order">
        {transfers.data
          ?.filter((t) => t.assetId === episode.asset?.id)
          .map((t) => (
            <div key={t.id}>
              <strong>{t.storage.name}</strong>
              <span className="status">
                {t.state} · {t.progress}%
              </span>
              {t.error && <small>{t.error}</small>}
            </div>
          ))}
      </div>
    </Modal>
  );
}
