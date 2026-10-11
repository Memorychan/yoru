'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Circle, Pause, UploadCloud, RefreshCw, ShieldCheck } from 'lucide-react';
import { Shell, useUser } from './shell';
import { useData, ErrorBox, Loading, Empty } from './ui';
import { post } from '@/lib/api';
import { useUploadTask, startUpload, pauseUpload, UPLOAD_CHUNK } from '@/lib/upload-client';
import type { Upload } from '@/lib/types';
export const byteLabel = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GiB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MiB`
      : `${(n / 1024).toFixed(1)} KiB`;
const stages = [
  ['UPLOADING', 'Source upload', 'Checksummed chunks saved to disk'],
  ['VALIDATING', 'Source verification', 'Verify every source chunk'],
  ['ENCODING', 'Quality renditions', 'Create audio and adaptive video'],
  ['ENCRYPTING', 'Encryption', 'Authenticate and encrypt each segment'],
  ['TRANSFERRING', 'Hugging Face transfer', 'Upload ciphertext from saved checkpoints'],
  ['VERIFYING', 'Remote verification', 'Download and verify every encrypted object'],
  ['READY', 'Ready to publish', 'Media is complete; publishing remains manual'],
];
function Content({ id }: { id: string }) {
  const user = useUser();
  const query = useData<Upload>(user?.role === 'ADMIN' ? `/admin/uploads/${id}` : null);
  const task = useUploadTask(id);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      query.reload();
      setNow(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, [id]);
  if (user?.role !== 'ADMIN')
    return <Empty title="Admin access required">This upload belongs to the admin studio.</Empty>;
  if (!query.data)
    return query.error ? <ErrorBox message={query.error} retry={query.reload} /> : <Loading />;
  const u = query.data;
  const total = Number(u.totalBytes);
  const received = Math.max(Number(u.receivedBytes), task.bytes);
  const fresh = u.heartbeatAt && now - new Date(u.heartbeatAt).getTime() < 15000;
  const speed = task.running ? task.speed : fresh ? u.speedBps : 0;
  const stage = stages.findIndex((s) => s[0] === u.state);
  const percentage = u.state === 'UPLOADING' ? (received / total) * 100 : u.stageProgress;
  const doneBytes = u.state === 'UPLOADING' ? received : Number(u.stageBytes);
  const totalStage = u.state === 'UPLOADING' ? total : Number(u.stageTotalBytes);
  async function action(path: string) {
    setError('');
    try {
      await post(path);
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page upload-detail">
      <Link className="back-link" href="/admin?section=uploads">
        <ArrowLeft size={16} /> Upload queue
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY CHUNK ACCOUNTED FOR</span>
          <h1>{u.filename}</h1>
          <p>
            {u.episode?.title.name} · {u.episode?.name}
          </p>
        </div>
        <span className={`status ${u.state === 'READY' ? 'good' : ''}`}>{u.state}</span>
      </div>
      {(error || task.error || query.error || u.error) && (
        <ErrorBox message={error || task.error || query.error || u.error || ''} />
      )}
      <div className="upload-metrics">
        <section className="panel">
          <span className="eyebrow">CURRENT STAGE</span>
          <h2>{Math.min(100, percentage).toFixed(1)}%</h2>
          <p>{u.stageDetail || 'Waiting for the source file'}</p>
        </section>
        <section className="panel">
          <span className="eyebrow">TRANSFER SPEED</span>
          <h2>{speed > 0 ? `${byteLabel(speed)}/s` : '—'}</h2>
          <p>
            {task.running ? 'Browser transfer rate' : 'Rate of confirmed data; idle shows no speed'}
          </p>
        </section>
        <section className="panel">
          <span className="eyebrow">SOURCE SAFELY SAVED</span>
          <h2>{byteLabel(received)}</h2>
          <p>
            of {byteLabel(total)} · {Math.ceil(received / UPLOAD_CHUNK)} /{' '}
            {Math.ceil(total / UPLOAD_CHUNK)} chunks
          </p>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>{stages[stage]?.[1] || u.state}</h2>
          <span className="muted">Refreshes every 2 seconds</span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Current stage progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percentage)}
        >
          <span style={{ width: `${Math.min(100, percentage)}%` }} />
        </div>
        <p className="muted">
          {task.running ? task.message : u.stageDetail}{' '}
          {task.inFlight > 0 && `${byteLabel(task.inFlight)} in flight (not yet acknowledged).`}
        </p>
        {totalStage > 0 && (
          <p className="muted">
            {byteLabel(doneBytes)} / {byteLabel(totalStage)} in this stage
            {speed > 0 && totalStage > doneBytes
              ? ` · approximately ${Math.ceil((totalStage - doneBytes) / speed)} seconds remaining`
              : ''}
          </p>
        )}
        {u.state === 'UPLOADING' &&
          (task.running ? (
            <button className="button glass" onClick={() => pauseUpload(id)}>
              <Pause size={16} />
              Pause upload
            </button>
          ) : (
            <label className="button primary">
              <UploadCloud size={16} /> Select original file to resume
              <input
                className="sr-only"
                type="file"
                accept="video/*,.mkv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void startUpload(id, f);
                  e.target.value = '';
                }}
              />
            </label>
          ))}
        {u.state === 'UPLOADING' && received === total && !task.running && (
          <button
            className="button primary"
            onClick={() => action(`/admin/uploads/${id}/complete`)}
          >
            Start processing
          </button>
        )}
        {u.state === 'FAILED' && (
          <button
            className="button primary"
            onClick={() => action(`/admin/uploads/${id}/complete`)}
          >
            <RefreshCw size={16} />
            Retry from checkpoints
          </button>
        )}
        {['QUEUED', 'RETRYING'].includes(u.state) && !fresh && (
          <p className="muted">Waiting for the worker to reconnect. Saved progress is retained.</p>
        )}
        {['VALIDATING', 'ENCODING', 'ENCRYPTING', 'TRANSFERRING', 'VERIFYING'].includes(u.state) &&
          !fresh && (
            <p className="muted">
              Worker heartbeat is stale. Start the worker to recover this job.
            </p>
          )}
      </section>
      <section className="panel upload-stages">
        {stages.map(([key, label, hint], i) => (
          <div className={`upload-stage ${i === stage ? 'current' : ''}`} key={key}>
            <span>
              {stage > i || u.state === 'READY' ? <Check size={19} /> : <Circle size={19} />}
            </span>
            <div>
              <strong>{label}</strong>
              <p>{hint}</p>
            </div>
            <small>
              {stage > i || u.state === 'READY' ? 'Complete' : stage === i ? 'Current' : 'Pending'}
            </small>
          </div>
        ))}
      </section>
      <div className="panel integrity-note">
        <ShieldCheck size={24} />
        <div>
          <strong>Restart-safe checkpoints</strong>
          <p>
            Saved bytes are acknowledged only after disk sync and a database commit. Interrupted
            chunks are resent, not skipped. Keep the staging disk, database and encryption key.
            After a browser restart, reselect the same file; no upload can continue while all app
            processes are stopped.
          </p>
          <p>
            Storage: {u.storage?.name} · {u.storage?.bucket}
          </p>
          <p>Last saved update: {new Date(u.updatedAt).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
export function UploadDetail({ id }: { id: string }) {
  return (
    <Shell>
      <Content id={id} />
    </Shell>
  );
}
