import { open, rename, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seal, type MediaManifest } from './core';
import { randomBytes } from 'node:crypto';
import { digest } from './upload-integrity';
export interface StoredSegment {
  local: string;
  object: string;
  hash: string;
  bytes: number;
  uploaded: boolean;
  verified: boolean;
}
export interface MediaCheckpoint {
  version: 1;
  uploadId: string;
  keyEncrypted: string;
  prefix: string;
  renditions: Record<string, Record<string, string>>;
  segments: Record<string, StoredSegment>;
  manifest: MediaManifest;
}
export async function durableWrite(path: string, bytes: Buffer | string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'w', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Windows scanners/readers may briefly deny replacement. Never unlink the good checkpoint.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, path);
      break;
    } catch (error) {
      if (
        !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '') ||
        attempt >= 11
      ) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 100 * 2 ** attempt)));
    }
  }
}
export async function checkpoint(folder: string, id: string): Promise<MediaCheckpoint> {
  try {
    const saved = JSON.parse(
      await readFile(join(folder, 'checkpoint.json'), 'utf8'),
    ) as MediaCheckpoint;
    if (saved.version !== 1 || saved.uploadId !== id)
      throw new Error('Incompatible media checkpoint.');
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const saved: MediaCheckpoint = {
      version: 1,
      uploadId: id,
      keyEncrypted: seal(randomBytes(32).toString('hex')),
      prefix: randomUUID(),
      renditions: {},
      segments: {},
      manifest: { master: '', playlists: {}, files: {} },
    };
    await saveCheckpoint(folder, saved);
    return saved;
  }
}
export const saveCheckpoint = (folder: string, saved: MediaCheckpoint) =>
  durableWrite(join(folder, 'checkpoint.json'), JSON.stringify(saved));
export async function recordRendition(folder: string, name: string) {
  const hashes: Record<string, string> = {};
  for (const file of await readdir(folder))
    if (file === `${name}.m3u8` || (file.startsWith(`${name}-`) && file.endsWith('.ts'))) {
      // Sync FFmpeg outputs before acknowledging the completed rendition.
      const handle = await open(join(folder, file), 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      hashes[file] = digest(await readFile(join(folder, file)));
    }
  if (!hashes[`${name}.m3u8`] || Object.keys(hashes).length < 2)
    throw new Error('Rendition did not produce a complete playlist and media.');
  return hashes;
}
export async function verifyRendition(folder: string, hashes: Record<string, string>) {
  for (const [file, hash] of Object.entries(hashes)) {
    if (digest(await readFile(join(folder, file))) !== hash)
      throw new Error('A saved rendition is damaged. Restore the staging disk before retrying.');
  }
}
