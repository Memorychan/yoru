'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud } from 'lucide-react';
import { Modal, Field, ErrorBox, useData } from './ui';
import { api, post } from '@/lib/api';
import { hashFile, startUpload } from '@/lib/upload-client';
import type { Episode, Storage, Upload } from '@/lib/types';
export function VideoUpload({
  episode,
  close,
}: {
  episode: Episode;
  close: () => void;
  done: () => void;
}) {
  const router = useRouter();
  const storage = useData<Storage[]>('/admin/storage');
  const [storageId, setStorageId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const closed = useRef(false);
  async function start() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const hashes = await hashFile(file, (n) =>
        setMessage(`Preparing chunk checksums · ${Math.round(n)}%`),
      );
      if (closed.current) return;
      const uploads = await api<Upload[]>('/admin/uploads');
      // Recovery comes from the database, so clearing browser storage does not lose the upload.
      let upload = uploads.find((u) => u.episode?.id === episode.id && u.state === 'UPLOADING');
      if (!upload)
        upload = await post<Upload>('/admin/uploads', {
          episodeId: episode.id,
          storageId: storageId || storage.data?.find((s) => s.enabled)?.id,
          filename: file.name,
          totalBytes: file.size,
          chunkHashes: hashes,
        });
      if (closed.current) return;
      void startUpload(upload.id, file, hashes);
      router.push(`/admin/uploads/${upload.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Upload · ${episode.name}`}
      close={() => {
        closed.current = true;
        close();
      }}
    >
      <p className="muted">
        Each chunk is checksummed before sending. Saved chunks survive application restarts on the
        same staging disk.
      </p>
      {error && <ErrorBox message={error} />}{' '}
      {storage.error && <ErrorBox message={storage.error} />}
      <Field label="Storage destination">
        <select disabled={busy} value={storageId} onChange={(e) => setStorageId(e.target.value)}>
          <option value="">First available connection</option>
          {storage.data
            ?.filter((s) => s.enabled)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.bucket}
              </option>
            ))}
        </select>
      </Field>
      <label className="dropzone">
        <UploadCloud size={34} />
        <strong>{file?.name || 'Choose the original video'}</strong>
        <span>MP4, MKV, MOV · 8 MiB verified chunks</span>
        <input
          className="sr-only"
          type="file"
          accept="video/*,.mkv"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <p role="status" className="muted">
        {message}
      </p>
      <div className="modal-actions">
        <button
          className="button primary"
          disabled={busy || !file || !storage.data?.some((s) => s.enabled)}
          onClick={start}
        >
          {busy ? 'Preparing…' : 'Upload / resume'} <UploadCloud size={16} />
        </button>
      </div>
    </Modal>
  );
}
