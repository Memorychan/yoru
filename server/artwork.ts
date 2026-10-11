import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, encrypt, decrypt, token } from './core';
import { hf } from './storage';
const pending = new Map<string, Promise<Buffer>>();
export const artworkName = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
function connection() {
  const bucket = process.env.BACKUP_HF_BUCKET;
  const access = process.env.BACKUP_HF_TOKEN;
  if (!bucket || !access)
    throw new Error('Configure BACKUP_HF_BUCKET and BACKUP_HF_TOKEN for persistent artwork.');
  return { bucket, token: access };
}
export async function saveArtwork(name: string, bytes: Buffer) {
  const object = `artwork/${name}.bin`;
  await mkdir(join(dataDir, 'fetch'), { recursive: true });
  const local = join(dataDir, 'fetch', token());
  try {
    await writeFile(local, encrypt(bytes, Buffer.from(process.env.MASTER_KEY!, 'hex'), object));
    await hf({ ...connection(), op: 'upload', files: [{ local, object }] });
    await mkdir(join(dataDir, 'artwork'), { recursive: true });
    await writeFile(join(dataDir, 'artwork', name), bytes);
  } finally {
    await unlink(local).catch(() => {});
  }
}
export async function loadArtwork(name: string): Promise<Buffer> {
  if (!artworkName.test(name)) throw new Error('Invalid artwork name.');
  try {
    return await readFile(join(dataDir, 'artwork', name));
  } catch {}
  if (pending.has(name)) return pending.get(name)!;
  const request = (async () => {
    await mkdir(join(dataDir, 'fetch'), { recursive: true });
    const local = join(dataDir, 'fetch', token());
    const object = `artwork/${name}.bin`;
    try {
      await hf({ ...connection(), op: 'download', object, local });
      const bytes = decrypt(
        await readFile(local),
        Buffer.from(process.env.MASTER_KEY!, 'hex'),
        object,
      );
      await mkdir(join(dataDir, 'artwork'), { recursive: true });
      await writeFile(join(dataDir, 'artwork', name), bytes);
      return bytes;
    } finally {
      await unlink(local).catch(() => {});
    }
  })();
  pending.set(name, request);
  try {
    return await request;
  } finally {
    pending.delete(name);
  }
}
