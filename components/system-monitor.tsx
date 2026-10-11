'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { useData, ErrorBox, Loading } from './ui';
import { byteLabel } from './upload-detail';
interface Snapshot {
  sampledAt: string;
  scope: string;
  cpu: number | null;
  cpuCapacity: number;
  ramUsed: number;
  ramTotal: number;
  disk: { total: number; available: number; used: number } | null;
  jobs: Record<string, number>;
  refreshedAt: string | null;
  buckets: {
    name: string;
    bucket: string;
    bytes?: number;
    private?: boolean;
    files?: number;
    error?: string;
  }[];
}
export function SystemMonitor() {
  const query = useData<Snapshot>('/admin/monitor');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(query.reload, 5000);
    return () => clearInterval(timer);
  }, [query.reload]);
  const data = query.data;
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">SPACE HEALTH</span>
          <h1>System monitor</h1>
          <p className="muted">
            CPU, memory and local disk refresh every 5 seconds. Remote bucket usage refreshes on
            request.
          </p>
        </div>
      </div>
      {query.error && <ErrorBox message={query.error} />}
      {error && <ErrorBox message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            {data.scope} · sampled {new Date(data.sampledAt).toLocaleTimeString()}
          </p>
          <div className="monitor-grid">
            <section className="panel">
              <h2>CPU</h2>
              <strong>{data.cpu === null ? 'Sampling…' : `${data.cpu.toFixed(1)}%`}</strong>
              <p>{data.cpuCapacity.toFixed(1)} CPU capacity</p>
            </section>
            <section className="panel">
              <h2>RAM</h2>
              <strong>{byteLabel(data.ramUsed)}</strong>
              <p>
                of {byteLabel(data.ramTotal)} · {((100 * data.ramUsed) / data.ramTotal).toFixed(1)}%
              </p>
            </section>
            <section className="panel">
              <h2>Local disk</h2>
              <strong>{data.disk ? byteLabel(data.disk.available) : 'Unavailable'}</strong>
              <p>
                available{' '}
                {data.disk &&
                  `· ${byteLabel(data.disk.used)} used of ${byteLabel(data.disk.total)}`}
              </p>
            </section>
          </div>
          <section className="panel">
            <h2>Media queue</h2>
            <p>
              {Object.entries(data.jobs)
                .map(([key, count]) => `${count} ${key}`)
                .join(' · ')}
            </p>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>HF bucket storage</h2>
              <button
                className="button glass"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await post('/admin/monitor/buckets', {});
                    query.reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Refreshing…' : 'Refresh bucket usage'}
              </button>
            </div>
            <p className="muted">
              Configured media and backup buckets only. Public/private describe bucket visibility,
              not separate Space disks. Refresh is limited to once per minute.
            </p>
            <p>
              {data.refreshedAt
                ? `Last refreshed: ${new Date(data.refreshedAt).toLocaleString()}`
                : 'Refresh to load remote usage.'}
            </p>
            <p>
              Public:{' '}
              {byteLabel(
                data.buckets
                  .filter((b) => b.private === false)
                  .reduce((n, b) => n + (b.bytes || 0), 0),
              )}{' '}
              · Private:{' '}
              {byteLabel(
                data.buckets
                  .filter((b) => b.private === true)
                  .reduce((n, b) => n + (b.bytes || 0), 0),
              )}
              {data.buckets.some((b) => b.error) && ' · Totals exclude unavailable buckets'}
            </p>
            {data.buckets.map((b) => (
              <div className="admin-episode" key={b.bucket}>
                <div>
                  <strong>{b.name}</strong>
                  <small>{b.bucket}</small>
                </div>
                <span>
                  {b.error ||
                    `${b.private ? 'Private' : 'Public'} · ${byteLabel(b.bytes || 0)} · ${b.files || 0} files`}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
