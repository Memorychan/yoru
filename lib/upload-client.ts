'use client';
import { useSyncExternalStore } from 'react';
import { api, post } from './api';
import type { Upload } from './types';
export const UPLOAD_CHUNK = 8 * 1024 * 1024;
type Snapshot = {
  running: boolean;
  message: string;
  bytes: number;
  inFlight: number;
  speed: number;
  error: string;
};
const idle: Snapshot = {
  running: false,
  message: 'Select the original file to resume.',
  bytes: 0,
  inFlight: 0,
  speed: 0,
  error: '',
};
const snapshots = new Map<string, Snapshot>();
const controls = new Map<string, AbortController>();
const listeners = new Set<() => void>();
function set(id: string, patch: Partial<Snapshot>) {
  snapshots.set(id, { ...(snapshots.get(id) || idle), ...patch });
  listeners.forEach((fn) => fn());
}
export function useUploadTask(id: string) {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshots.get(id) || idle,
    () => idle,
  );
}
export function pauseUpload(id: string) {
  controls.get(id)?.abort();
  set(id, { running: false, speed: 0, inFlight: 0, message: 'Paused. Saved chunks are retained.' });
}
export async function hashFile(file: File, progress?: (value: number) => void) {
  if (!crypto.subtle)
    throw new Error(
      'Verified uploads need HTTPS or localhost. Open the app over a secure connection.',
    );
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK) {
    const buffer = await file.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer();
    hashes.push(
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
    progress?.(Math.min(100, ((offset + buffer.byteLength) / file.size) * 100));
  }
  return hashes;
}
class TransferError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
function sendChunk(id: string, chunk: Blob, offset: number, signal: AbortSignal): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const start = performance.now();
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('POST', `/api/admin/uploads/${id}/chunk`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.timeout = 180000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.upload.onprogress = (e) =>
      set(id, {
        inFlight: e.loaded,
        speed: e.loaded / Math.max(0.001, (performance.now() - start) / 1000),
        message: 'Sending chunk; awaiting durable acknowledgement.',
      });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new TransferError(xhr.response?.message || 'Server unavailable.', xhr.status));
    };
    xhr.onerror = () => reject(new TransferError('Connection interrupted.'));
    xhr.ontimeout = () => reject(new TransferError('Chunk timed out.'));
    xhr.onabort = () => reject(new DOMException('Paused', 'AbortError'));
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) {
      reject(new DOMException('Paused', 'AbortError'));
      return;
    }
    xhr.send(chunk);
  });
}
// This task is owned by the browser tab, not by a page component. Internal navigation keeps it alive.
export async function startUpload(id: string, file: File, hashes?: string[]) {
  if (controls.has(id)) return;
  const control = new AbortController();
  controls.set(id, control);
  set(id, { running: true, error: '', message: 'Verifying selected file…', speed: 0 });
  try {
    const manifest =
      hashes ||
      (await hashFile(file, (n) =>
        set(id, { message: `Verifying file identity · ${Math.round(n)}%` }),
      ));
    if (control.signal.aborted) return;
    let upload = await post<Upload>(`/admin/uploads/${id}/resume`, {
      totalBytes: file.size,
      chunkHashes: manifest,
    });
    let attempts = 0;
    while (Number(upload.receivedBytes) < file.size) {
      if (control.signal.aborted) return;
      const offset = Number(upload.receivedBytes);
      set(id, { bytes: offset, inFlight: 0 });
      try {
        upload = await sendChunk(
          id,
          file.slice(offset, offset + UPLOAD_CHUNK),
          offset,
          control.signal,
        );
        attempts = 0;
        set(id, {
          bytes: Number(upload.receivedBytes),
          inFlight: 0,
          message: 'Chunk checksum verified and saved.',
        });
      } catch (error) {
        if (control.signal.aborted) return;
        if (
          error instanceof TransferError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![408, 409, 429].includes(error.status)
        )
          throw error;
        const seconds = Math.min(30, 2 ** Math.min(++attempts, 5));
        set(id, {
          speed: 0,
          inFlight: 0,
          message: `Connection interrupted. Retrying saved offset in ${seconds}s…`,
        });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            control.signal.removeEventListener('abort', abort);
            resolve();
          }, seconds * 1000);
          const abort = () => {
            clearTimeout(timer);
            resolve();
          };
          control.signal.addEventListener('abort', abort, { once: true });
        });
        if (control.signal.aborted) return;
        try {
          upload = await api<Upload>(`/admin/uploads/${id}`);
        } catch {
          continue;
        }
        if (upload.state !== 'UPLOADING')
          throw new Error('Upload state changed. Refresh the details.');
      }
    }
    // Completion may also lose its response. Read durable state before retrying it.
    while (!control.signal.aborted) {
      set(id, { speed: 0, inFlight: 0, message: 'All source chunks saved. Queuing processing…' });
      try {
        await post(`/admin/uploads/${id}/complete`);
        break;
      } catch (error) {
        let current: Upload | undefined;
        try {
          current = await api<Upload>(`/admin/uploads/${id}`);
        } catch {}
        if (current && current.state !== 'UPLOADING') {
          if (current.state === 'CANCELLED') throw new Error('Upload cancelled.');
          break;
        }
        if (current) throw error;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    if (!control.signal.aborted)
      set(id, { message: 'Source complete. Background processing continues.', bytes: file.size });
  } catch (error) {
    if (!control.signal.aborted)
      set(id, {
        error: (error as Error).message,
        message: 'Upload paused; saved chunks are retained.',
      });
  } finally {
    controls.delete(id);
    set(id, { running: false, inFlight: 0, speed: 0 });
  }
}
