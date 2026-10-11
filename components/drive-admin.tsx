'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { post } from '@/lib/api';
import { useData, ErrorBox, Loading } from './ui';
import type { Title, Storage } from '@/lib/types';
interface FileEntry {
  id: string;
  name: string;
  path: string;
  size?: string;
  mimeType: string;
  eligible: boolean;
  season: number;
  capabilities?: { canDownload?: boolean };
}
interface Review {
  inventory: string;
  folder: string;
  folders: number;
  totalBytes: number;
  files: FileEntry[];
}
interface Choice {
  id: string;
  name: string;
  season: number;
  number: number;
}
interface ImportRow {
  id: string;
  state: string;
  error?: string;
  uploadId: string;
  upload?: {
    filename: string;
    state: string;
    receivedBytes: string;
    totalBytes: string;
    stageDetail: string;
  };
}
function size(value: number) {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}
export function DriveManager({ initialTitleId = '', onApproved }: { initialTitleId?: string; onApproved?: () => void } = {}) {
  const status = useData<{ configured: boolean; connected: boolean }>('/admin/drive/status');
  const titles = useData<Title[]>('/admin/titles');
  const storages = useData<Storage[]>('/admin/storage');
  const imports = useData<ImportRow[]>('/admin/drive/imports');
  useEffect(() => {
    const timer = setInterval(imports.reload, 5000);
    return () => clearInterval(timer);
  }, [imports.reload]);
  const [folder, setFolder] = useState(''),
    [titleId, setTitleId] = useState(initialTitleId),
    [storageId, setStorageId] = useState('');
  const [review, setReview] = useState<Review | null>(null),
    [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('drive');
    if (result === 'connected') setNotice('Google Drive connected. Inspect a folder to begin.');
    if (result === 'failed' || result === 'denied')
      setError(
        'Google authorization was not completed. Check the client settings and try Connect again.',
      );
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function suggested(file: FileEntry): Choice {
    const season = Number(/s(\d{1,3})e\d+/i.exec(file.name)?.[1] || file.season || 1);
    const episode = /(?:s\d+e|episode\s*|\bep?\s*)(\d+)/i.exec(file.name)?.[1];
    const used = choices.filter((choice) => choice.season === season);
    return {
      id: file.id,
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
      season,
      number: episode ? Number(episode) : Math.max(0, ...used.map((choice) => choice.number)) + 1,
    };
  }
  function selectAll(source = review) {
    const counter = new Map<number, number>();
    setChoices(
      (source?.files || [])
        .filter((file) => file.eligible)
        .map((file) => {
          const choice = suggested(file);
          const parsed = /(?:s\d+e|episode\s*|\bep?\s*)(\d+)/i.exec(file.name);
          choice.number = parsed ? Number(parsed[1]) : (counter.get(choice.season) || 0) + 1;
          counter.set(choice.season, Math.max(counter.get(choice.season) || 0, choice.number));
          return choice;
        }),
    );
  }
  const total = choices.reduce(
    (sum, choice) => sum + Number(review?.files.find((file) => file.id === choice.id)?.size || 0),
    0,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">CLOUD TO YOUR COLLECTION</span>
          <h1>Google Drive imports</h1>
          <p className="muted">
            Review seasons and episodes before downloading anything to this server.
          </p>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {notice && <div className="success-box">{notice}</div>}
      <section className="panel">
        <h2>Private Drive connection</h2>
        <p className="muted">
          Read-only access to the Google account you authorize. Tokens are encrypted; Google files
          are never modified.
        </p>
        {!status.data?.configured && (
          <p>
            Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. See docs/GOOGLE_DRIVE_IMPORT.md for
            setup.
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !status.data?.configured}
          onClick={() =>
            void run(async () => {
              const result = await post<{ url: string }>('/admin/drive/connect', {});
              window.location.assign(result.url);
            })
          }
        >
          {status.data?.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
        </button>
        {status.data?.connected && (
          <button
            className="button glass"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await post('/admin/drive/disconnect', {});
                status.reload();
                setReview(null);
                setChoices([]);
              })
            }
          >
            Disconnect
          </button>
        )}
      </section>
      <section className="panel">
        <h2>1. Inspect a folder</h2>
        <form
          className="invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setReview(null);
              setChoices([]);
              setNotice('');
              const preview = await post<Review>('/admin/drive/preview', { folder });
              setReview(preview);
              selectAll(preview);
            });
          }}
        >
          <input
            aria-label="Google Drive folder link"
            placeholder="Private Drive folder URL or folder ID"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            required
          />
          <button className="button primary" disabled={busy || !status.data?.connected}>
            {busy ? 'Working…' : 'Inspect folder'}
          </button>
        </form>
        <p className="muted">
          Nested season folders are included. Shortcuts, documents and unavailable downloads are
          shown but cannot be imported. A preview expires after 30 minutes.
        </p>
      </section>
      {review && (
        <section className="panel">
          <h2>2. Review {review.folder}</h2>
          <p>
            {review.files.length} files · {review.files.filter((file) => file.eligible).length}{' '}
            downloadable videos · {review.folders} folders · {size(review.totalBytes)} total
          </p>
          <button className="button small glass" onClick={() => selectAll()} disabled={busy}>
            Select all videos
          </button>{' '}
          <button className="button small glass" onClick={() => setChoices([])} disabled={busy}>
            Clear selection
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>File / folder</th>
                  <th>Size</th>
                  <th>Episode name</th>
                  <th>Season</th>
                  <th>Episode</th>
                </tr>
              </thead>
              <tbody>
                {review.files.map((file) => {
                  const choice = choices.find((item) => item.id === file.id);
                  const edit = (field: string, value: string | number) =>
                    setChoices((items) =>
                      items.map((item) =>
                        item.id === file.id ? { ...item, [field]: value } : item,
                      ),
                    );
                  return (
                    <tr key={file.id}>
                      <td>
                        <input
                          aria-label={`Select ${file.name}`}
                          type="checkbox"
                          disabled={!file.eligible || busy}
                          checked={!!choice}
                          onChange={(event) =>
                            setChoices((items) =>
                              event.target.checked
                                ? [...items, suggested(file)]
                                : items.filter((item) => item.id !== file.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>{file.name}</strong>
                        <small className="drive-path">{file.path}</small>
                        {!file.eligible && (
                          <small className="muted">
                            {!file.capabilities?.canDownload
                              ? 'Downloading not allowed'
                              : 'Not a supported video, empty, or exceeds the upload limit'}
                          </small>
                        )}
                      </td>
                      <td>{size(Number(file.size || 0))}</td>
                      <td>
                        {choice && (
                          <input
                            aria-label={`Episode name for ${file.name}`}
                            value={choice.name}
                            maxLength={200}
                            onChange={(event) => edit('name', event.target.value)}
                          />
                        )}
                      </td>
                      <td>
                        {choice && (
                          <input
                            className="drive-number"
                            aria-label={`Season for ${file.name}`}
                            type="number"
                            min={1}
                            max={1000}
                            value={choice.season}
                            onChange={(event) => edit('season', Number(event.target.value))}
                          />
                        )}
                      </td>
                      <td>
                        {choice && (
                          <input
                            className="drive-number"
                            aria-label={`Episode number for ${file.name}`}
                            type="number"
                            min={1}
                            max={10000}
                            value={choice.number}
                            onChange={(event) => edit('number', Number(event.target.value))}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h2>3. Approve destination</h2>
          <p>
            {choices.length} selected videos · {size(total)} source data. Conversion needs
            additional disk space.
          </p>
          <div className="form-grid">
            <label>
              Destination title
              <select
                aria-label="Destination title"
                value={titleId}
                onChange={(event) => setTitleId(event.target.value)}
              >
                <option value="">Choose a draft title</option>
                {titles.data
                  ?.filter((title) => title.status === 'DRAFT')
                  .map((title) => (
                    <option key={title.id} value={title.id}>
                      {title.name} · {title.format}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              HF storage
              <select
                aria-label="HF storage"
                value={storageId}
                onChange={(event) => setStorageId(event.target.value)}
              >
                <option value="">Choose storage</option>
                {storages.data
                  ?.filter((storage) => storage.enabled)
                  .map((storage) => (
                    <option key={storage.id} value={storage.id}>
                      {storage.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className="muted">
            Episodes are created automatically when you approve. You do not need to add them manually.
            Use a Series title for multiple seasons. Create one in{' '}
            <Link href="/admin/titles/new">New title</Link> first. Existing videos will not be
            replaced.
          </p>
          <button
            className="button primary"
            disabled={busy || !choices.length || !titleId || !storageId}
            onClick={() =>
              void run(async () => {
                const result = await post<{ count: number }>('/admin/drive/approve', {
                  inventory: review.inventory,
                  titleId,
                  storageId,
                  files: choices,
                });
                setNotice(
                  `${result.count} imports approved. Downloads and processing happen on this server.`,
                );
                setReview(null);
                setChoices([]);
                imports.reload();
                onApproved?.();
              })
            }
          >
            Create episodes and import {choices.length} videos
          </button>
        </section>
      )}
      <section className="panel">
        <h2>Import history</h2>
        {imports.loading && <Loading />}
        {imports.error && <ErrorBox message={imports.error} retry={imports.reload} />}
        {imports.data?.map((item) => (
          <div className="admin-episode" key={item.id}>
            <div>
              <strong>{item.upload?.filename}</strong>
              <small>
                {item.state === 'DONE' ? item.upload?.state : item.state} ·{' '}
                {size(Number(item.upload?.receivedBytes || 0))} /{' '}
                {size(Number(item.upload?.totalBytes || 0))}
              </small>
              {item.error && <p className="danger">{item.error}</p>}
            </div>
            <Link className="button small glass" href={`/admin/uploads/${item.uploadId}`}>
              Progress / cancel
            </Link>
            {item.state === 'FAILED' && (
              <button
                className="button small glass"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await post(`/admin/drive/imports/${item.id}/retry`, {});
                    imports.reload();
                  })
                }
              >
                Retry download
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
