import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { db, unseal } from './core';
import { pooledDownload } from './hf-download-pool';
class StorageOperationError extends BadRequestException {
  constructor(
    message: string,
    readonly storageCode: string,
  ) {
    super(message);
  }
}
// Credential rotation must take effect during long-running jobs, not only at job startup.
export async function hfForStorage<T = unknown>(
  storageId: string,
  command: Record<string, unknown>,
  onRetry?: (message: string) => void,
): Promise<T> {
  const current = await db.storage.findUniqueOrThrow({ where: { id: storageId } });
  try {
    return await hf<T>(
      { ...command, bucket: current.bucket, token: unseal(current.tokenEncrypted) },
      onRetry,
    );
  } catch (error) {
    if (!(error instanceof StorageOperationError) || error.storageCode !== 'HF_HTTP_401')
      throw error;
    const refreshed = await db.storage.findUniqueOrThrow({ where: { id: storageId } });
    if (refreshed.tokenEncrypted === current.tokenEncrypted) throw error;
    onRetry?.('Admin credential changed; retrying this batch with the current saved token.');
    return hf<T>(
      { ...command, bucket: refreshed.bucket, token: unseal(refreshed.tokenEncrypted) },
      onRetry,
    );
  }
}
// Secrets go over stdin, never process arguments or logs. HF SDK owns redirects and token handling.
export function hf<T = unknown>(
  command: Record<string, unknown>,
  onRetry?: (message: string) => void,
): Promise<T> {
  if (command.op === 'download') {
    return pooledDownload(command).then((result) => {
      if (result.ok === false)
        throw new StorageOperationError(
          String(result.message),
          String(result.code || 'HF_OPERATION_FAILED'),
        );
      return result as T;
    });
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python', [resolve('scripts/hf-storage.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let errorLine = '';
    const timeout = setTimeout(
      () => {
        child.kill();
        reject(new Error('Storage operation timed out'));
      },
      ['upload', 'download-many'].includes(String(command.op))
        ? 30 * 60 * 1000
        : command.op === 'download'
          ? 20 * 1000
          : 60 * 1000,
    );
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      errorLine += b.toString();
      const lines = errorLine.split(/\r?\n/);
      errorLine = (lines.pop() || '').slice(-1000);
      for (const line of lines) {
        // Only forward our adapter's fixed diagnostic, never raw SDK URLs/errors.
        if (
          /^HF transfer connection interrupted; retrying the same batch \(\d+\/\d+\)\.$/.test(line)
        )
          onRetry?.(line);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(
        new BadRequestException(
          'The HF adapter could not start. Configure PYTHON_BIN and install requirements.txt.',
        ),
      );
    });
    child.stdin.on('error', () => {
      /* The child error/exit handler reports the operation failure. */
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        return reject(
          new BadRequestException(
            'The Hugging Face adapter failed. Set PYTHON_BIN to your Python environment and install requirements.txt; then check token and bucket access.',
          ),
        );
      try {
        const result = JSON.parse(out);
        if (result.ok === false)
          return reject(
            new StorageOperationError(result.message, result.code || 'HF_OPERATION_FAILED'),
          );
        resolveResult(result);
      } catch {
        reject(new Error('Invalid storage response'));
      }
    });
    child.stdin.end(JSON.stringify(command));
  });
}
