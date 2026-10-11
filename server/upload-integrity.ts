import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { BadRequestException } from '@nestjs/common';
export const CHUNK_SIZE = 8 * 1024 * 1024;
export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function validateHashes(hashes: string[], total: number) {
  if (
    hashes.length !== Math.ceil(total / CHUNK_SIZE) ||
    hashes.some((h) => !/^[a-f0-9]{64}$/.test(h))
  )
    throw new BadRequestException('The file integrity manifest does not match its size.');
}
export async function verifySource(
  path: string,
  hashes: string[],
  total: number,
  progress?: (bytes: number) => Promise<void>,
) {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size < total)
      throw new BadRequestException(
        'Saved source bytes are missing. Restore the staging disk before resuming.',
      );
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
      const length = Math.min(CHUNK_SIZE, total - offset);
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const part = await handle.read(bytes, read, length - read, offset + read);
        if (!part.bytesRead) throw new Error('Incomplete source read.');
        read += part.bytesRead;
      }
      if (digest(bytes) !== hashes[offset / CHUNK_SIZE])
        throw new BadRequestException(
          'Source integrity check failed. This file differs from the saved upload.',
        );
      if (progress) await progress(offset + length);
    }
  } finally {
    await handle.close();
  }
}
