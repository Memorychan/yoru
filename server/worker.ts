import 'reflect-metadata';
import 'dotenv/config';
import { Worker } from 'bullmq';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, rm, unlink, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  db,
  redis,
  queue,
  dataDir,
  encrypt,
  decrypt,
  unseal,
  createWorkerConnection,
} from './core';
import { connectionReason } from './connection-errors';
import { hfForStorage } from './storage';
import { processTransfer } from './transfers';
import { processDriveImport, recoverDriveImports } from './drive';
import { digest, verifySource } from './upload-integrity';
import {
  checkpoint,
  saveCheckpoint,
  durableWrite,
  recordRendition,
  verifyRendition,
} from './media-checkpoint';
const children = new Set<ChildProcess>();
let stopping = false;
function command(
  bin: string,
  args: string[],
  onProgress?: (seconds: number) => void,
): Promise<string> {
  return new Promise((ok, fail) => {
    if (stopping) return fail(new Error('Worker paused for shutdown. Checkpoints retained.'));
    const child = spawn(bin, args, { windowsHide: true });
    children.add(child);
    let out = '';
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      const value = chunk.toString();
      if (!onProgress) {
        out += value;
        return;
      }
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match) onProgress(Number(match[1]) / 1e6);
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      children.delete(child);
      fail(new Error('Media tool could not start. Check FFmpeg/FFprobe configuration.'));
    });
    child.on('close', (code) => {
      children.delete(child);
      code === 0
        ? ok(out)
        : fail(
            new Error(
              stopping
                ? 'Worker paused for shutdown. Checkpoints retained.'
                : 'Video processing interrupted. Source and completed checkpoints are retained.',
            ),
          );
    });
  });
}
async function safeRemove(path: string) {
  if (!resolve(path).startsWith(resolve(dataDir, 'processing') + sep))
    throw new Error('Unsafe processing path');
  await rm(path, { recursive: true, force: true });
}
const workerConnection = createWorkerConnection();
const worker = new Worker(
  'media',
  async (job) => {
    if (job.name === 'transfer') return processTransfer(job.data.transferId);
    if (job.name === 'drive-import') return processDriveImport(job.data.importId);
    const upload = await db.upload.findUniqueOrThrow({
      where: { id: job.data.uploadId },
      include: { storage: true },
    });
    if (['READY', 'CANCELLED', 'COLAB_ENCODING'].includes(upload.state)) return;
    if (
      (await redis.get('colab:enabled')) &&
      !(await stat(join(dataDir, 'processing', upload.id, 'colab-ready'))
        .then(() => true)
        .catch(() => false)) &&
      !(await stat(join(dataDir, 'processing', upload.id, 'colab-local'))
        .then(() => true)
        .catch(() => false))
    ) {
      await db.upload.updateMany({
        where: { id: upload.id, state: { notIn: ['READY', 'CANCELLED', 'FAILED'] } },
        data: {
          state: 'COLAB_ENCODING',
          stageDetail: 'Waiting for Colab GPU worker',
          heartbeatAt: new Date(),
          speedBps: 0,
        },
      });
      return;
    }
    const folder = resolve(dataDir, 'processing', upload.id);
    if (!folder.startsWith(resolve(dataDir, 'processing') + sep))
      throw new Error('Unsafe processing path');
    const source = join(dataDir, 'uploads', upload.id);
    let phase = 'VALIDATING';
    let lastTick = 0;
    let pendingTick = Promise.resolve();
    const update = async (
      state: string,
      percentage: number,
      detail: string,
      bytes = 0,
      total = 0,
      speed = 0,
    ) => {
      phase = state;
      await db.upload.update({
        where: { id: upload.id },
        data: {
          state,
          progress: Math.floor(percentage),
          stageProgress: percentage,
          stageDetail: detail,
          stageBytes: BigInt(bytes),
          stageTotalBytes: BigInt(total),
          speedBps: speed,
          heartbeatAt: new Date(),
          error: null,
        },
      });
    };
    const heartbeat = setInterval(() => {
      void db.upload
        .updateMany({
          where: { id: upload.id, state: { notIn: ['READY', 'CANCELLED', 'FAILED'] } },
          data: { heartbeatAt: new Date() },
        })
        .catch(() => {});
    }, 5000);
    try {
      await mkdir(folder, { recursive: true });
      const saved = await checkpoint(folder, upload.id);
      const key = Buffer.from(unseal(saved.keyEncrypted), 'hex');
      await update('VALIDATING', 0, 'Checking saved source chunks', 0, Number(upload.totalBytes));
      if (upload.chunkHashes.length)
        await verifySource(source, upload.chunkHashes, Number(upload.totalBytes), async (bytes) => {
          if (Date.now() - lastTick > 1000 || bytes === Number(upload.totalBytes)) {
            lastTick = Date.now();
            await update(
              'VALIDATING',
              (bytes / Number(upload.totalBytes)) * 100,
              'Verifying source checksums',
              bytes,
              Number(upload.totalBytes),
            );
          }
        });
      const metadata = JSON.parse(
        await command(process.env.FFPROBE_BIN || 'ffprobe', [
          '-v',
          'error',
          '-show_streams',
          '-show_format',
          '-show_chapters',
          '-of',
          'json',
          source,
        ]),
      );
      const video = metadata.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
      if (!video) throw new Error('No video stream found.');
      const duration = Number(metadata.format.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid source duration.');
      const heights = [360, 720, 1080].filter((h) => h <= video.height);
      if (!heights.length) heights.push(Math.max(2, Math.floor(video.height / 2) * 2));
      const audios = metadata.streams
        .filter((s: { codec_type: string }) => s.codec_type === 'audio')
        .slice(0, 8);
      const totalRenditions = audios.length + heights.length;
      let completed = 0;
      saved.manifest.master = '#EXTM3U\n#EXT-X-VERSION:3\n';
      async function rendition(name: string, label: string, args: string[]) {
        await update(
          'ENCODING',
          (completed / totalRenditions) * 100,
          `${label} · ${completed}/${totalRenditions} renditions saved`,
        );
        if (saved.renditions[name]) await verifyRendition(folder, saved.renditions[name]);
        else {
          // Only the interrupted rendition is rebuilt; completed renditions remain intact.
          for (const file of await readdir(folder))
            if (file === `${name}.m3u8` || (file.startsWith(`${name}-`) && file.endsWith('.ts')))
              await unlink(join(folder, file));
          const attempt = join(folder, `attempt-${randomUUID()}`);
          await mkdir(attempt, { recursive: true });
          await command(
            process.env.FFMPEG_BIN || 'ffmpeg',
            [
              '-y',
              '-v',
              'error',
              '-progress',
              'pipe:1',
              '-nostats',
              '-i',
              source,
              ...args,
              '-f',
              'hls',
              '-hls_time',
              '6',
              '-hls_playlist_type',
              'vod',
              '-hls_segment_filename',
              join(attempt, `${name}-%05d.ts`),
              join(attempt, `${name}.m3u8`),
            ],
            (seconds) => {
              if (Date.now() - lastTick < 1500) return;
              lastTick = Date.now();
              const percent =
                ((completed + Math.min(0.999, seconds / duration)) / totalRenditions) * 100;
              pendingTick = pendingTick
                .then(() =>
                  update(
                    'ENCODING',
                    percent,
                    `${label} · ${Math.floor(seconds)} / ${Math.floor(duration)} seconds`,
                  ),
                )
                .catch(() => {});
            },
          );
          await pendingTick;
          for (const file of await readdir(attempt))
            await durableWrite(join(folder, file), await readFile(join(attempt, file)));
          saved.renditions[name] = await recordRendition(folder, name);
          await saveCheckpoint(folder, saved);
          await safeRemove(attempt);
        }
        saved.manifest.playlists[`${name}.m3u8`] = await readFile(
          join(folder, `${name}.m3u8`),
          'utf8',
        );
        completed++;
        await update(
          'ENCODING',
          (completed / totalRenditions) * 100,
          `${label} complete · ${completed}/${totalRenditions} renditions saved`,
        );
      }
      for (let i = 0; i < audios.length; i++) {
        const name = `audio${i}`;
        const language = String(audios[i].tags?.language || `Track ${i + 1}`).replace(
          /[^a-zA-Z0-9 -]/g,
          '',
        );
        await rendition(name, `Audio ${i + 1}`, [
          '-map',
          `0:${audios[i].index}`,
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
        ]);
        saved.manifest.master += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${language} ${i + 1}",DEFAULT=${i === 0 ? 'YES' : 'NO'},AUTOSELECT=YES,URI="${name}.m3u8"\n`;
      }
      for (const height of heights) {
        const name = `v${height}`;
        await rendition(name, `${height}p video`, [
          '-map',
          '0:v:0',
          '-an',
          '-vf',
          `scale=-2:${height}`,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '22',
          '-pix_fmt',
          'yuv420p',
          '-force_key_frames',
          'expr:gte(t,n_forced*6)',
          '-sc_threshold',
          '0',
        ]);
        const bandwidth = height >= 1080 ? 6000000 : height >= 720 ? 3500000 : 1200000;
        const width = Math.round(((video.width / video.height) * height) / 2) * 2;
        saved.manifest.master += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height}${audios.length ? ',AUDIO="audio"' : ''}\n${name}.m3u8\n`;
      }
      const names = Object.keys(saved.manifest.playlists).flatMap((playlist) =>
        Object.keys(saved.renditions[playlist.replace('.m3u8', '')]).filter((n) =>
          n.endsWith('.ts'),
        ),
      );
      if (!names.length) throw new Error('No encoded media segments.');
      await update('ENCRYPTING', 0, 'Restoring encrypted segment checkpoints');
      let unsavedSegments = 0;
      for (let i = 0; i < names.length; i++) {
        if (stopping) throw new Error('Worker paused for shutdown. Checkpoints retained.');
        const name = names[i];
        let segment = saved.segments[name];
        if (segment) {
          if (digest(await readFile(join(folder, segment.local))) !== segment.hash)
            throw new Error('Saved ciphertext is damaged. Restore staging data before retrying.');
        } else {
          const object = `${saved.prefix}/${randomUUID()}.bin`;
          const encrypted = encrypt(await readFile(join(folder, name)), key, object);
          const local = `${randomUUID()}.bin`;
          await durableWrite(join(folder, local), encrypted);
          segment = {
            local,
            object,
            hash: digest(encrypted),
            bytes: encrypted.length,
            uploaded: false,
            verified: false,
          };
          saved.segments[name] = segment;
          unsavedSegments++;
        }
        saved.manifest.files[name] = { object: segment.object, type: 'video/mp2t' };
        // Reused ciphertext is already durable. Batch new entries to avoid rewriting
        // a growing multi-megabyte manifest for every tiny segment.
        if (unsavedSegments >= 8 || i === names.length - 1) {
          await saveCheckpoint(folder, saved);
          unsavedSegments = 0;
        }
        if (Date.now() - lastTick > 1000 || i === names.length - 1) {
          lastTick = Date.now();
          await update(
            'ENCRYPTING',
            ((i + 1 - unsavedSegments) / names.length) * 100,
            `${i + 1 - unsavedSegments} / ${names.length} segments encrypted and checkpointed`,
          );
        }
      }
      const segments = names.map((name) => saved.segments[name]);
      const total = segments.reduce((n, s) => n + s.bytes, 0);
      let uploaded = segments.filter((s) => s.uploaded).reduce((n, s) => n + s.bytes, 0);
      await update(
        'TRANSFERRING',
        (uploaded / total) * 100,
        'Resuming confirmed HF objects',
        uploaded,
        total,
      );
      const remaining = segments.filter((s) => !s.uploaded);
      for (let offset = 0; offset < remaining.length;) {
        if (stopping) throw new Error('Worker paused for shutdown. Checkpoints retained.');
        // Amortize Python/Xet session setup across small audio segments while
        // bounding each acknowledgement/checkpoint batch by count and bytes.
        const batch: typeof remaining = [];
        let batchBytes = 0;
        while (offset + batch.length < remaining.length && batch.length < 64) {
          const segment = remaining[offset + batch.length];
          if (batch.length && batchBytes + segment.bytes > 64 * 1024 * 1024) break;
          batch.push(segment);
          batchBytes += segment.bytes;
        }
        const start = Date.now();
        await hfForStorage(
          upload.storageId,
          {
            op: 'upload',
            files: batch.map((s) => ({ local: join(folder, s.local), object: s.object })),
          },
          (message) => {
            pendingTick = pendingTick
              .then(() =>
                update('TRANSFERRING', (uploaded / total) * 100, message, uploaded, total, 0),
              )
              .catch(() => {
                console.warn('Could not save HF retry status; transfer checkpoint is unchanged.');
              });
          },
        );
        await pendingTick;
        for (const segment of batch) segment.uploaded = true;
        await saveCheckpoint(folder, saved);
        offset += batch.length;
        const bytes = batch.reduce((n, s) => n + s.bytes, 0);
        uploaded += bytes;
        await update(
          'TRANSFERRING',
          (uploaded / total) * 100,
          `${segments.filter((s) => s.uploaded).length} / ${segments.length} objects acknowledged by HF`,
          uploaded,
          total,
          bytes / Math.max(0.001, (Date.now() - start) / 1000),
        );
      }
      let verified = segments.filter((s) => s.verified).reduce((n, s) => n + s.bytes, 0);
      await update(
        'VERIFYING',
        (verified / total) * 100,
        'Verifying every remote object',
        verified,
        total,
      );
      const unchecked = segments.filter((s) => !s.verified);
      for (let offset = 0; offset < unchecked.length; offset += 8) {
        if (stopping) throw new Error('Worker paused for shutdown. Checkpoints retained.');
        const batch = unchecked.slice(offset, offset + 8);
        const files = batch.map((s) => ({
          object: s.object,
          local: join(folder, `verify-${randomUUID()}.bin`),
        }));
        const start = Date.now();
        let corrupted = false;
        try {
          await hfForStorage(upload.storageId, {
            op: 'download-many',
            files,
          });
          for (let i = 0; i < batch.length; i++) {
            const bytes = await readFile(files[i].local);
            if (digest(bytes) !== batch[i].hash) {
              corrupted = true;
              throw new Error('Remote checksum mismatch. The affected batch will be re-sent.');
            }
            try {
              decrypt(bytes, key, batch[i].object);
            } catch (error) {
              corrupted = true;
              throw error;
            }
          }
          for (const segment of batch) segment.verified = true;
          await saveCheckpoint(folder, saved);
        } catch (error) {
          // A failed download does not invalidate an acknowledged upload.
          // Re-upload only when fetched ciphertext actually fails integrity checks.
          if (corrupted) {
            for (const segment of batch) {
              segment.uploaded = false;
              segment.verified = false;
            }
            await saveCheckpoint(folder, saved);
          }
          throw error;
        } finally {
          for (const file of files) await unlink(file.local).catch(() => {});
        }
        const bytes = batch.reduce((n, s) => n + s.bytes, 0);
        verified += bytes;
        await update(
          'VERIFYING',
          (verified / total) * 100,
          `${segments.filter((s) => s.verified).length} / ${segments.length} remote objects verified`,
          verified,
          total,
          bytes / Math.max(0.001, (Date.now() - start) / 1000),
        );
      }
      await db.$transaction(async (tx) => {
        const old = await tx.asset.findUnique({ where: { episodeId: upload.episodeId } });
        if (old) {
          await tx.asset.update({ where: { id: old.id }, data: { bytes: old.bytes } });
          await tx.assetReplica.deleteMany({ where: { assetId: old.id } });
        }
        const data = {
          storageId: upload.storageId,
          keyEncrypted: saved.keyEncrypted,
          manifest: JSON.parse(JSON.stringify(saved.manifest)),
          bytes: BigInt(total),
        };
        await tx.asset.upsert({
          where: { episodeId: upload.episodeId },
          create: { episodeId: upload.episodeId, ...data },
          update: data,
        });
        const episode = await tx.episode.findUniqueOrThrow({
          where: { id: upload.episodeId },
          include: { title: true },
        });
        const markers: {
          introStart?: number;
          introEnd?: number;
          outroStart?: number;
          outroEnd?: number;
        } = {};
        if (episode.title.category === 'ANIME' && episode.title.format === 'SERIES') {
          for (const chapter of metadata.chapters || []) {
            const label = String(chapter.tags?.title || '').trim();
            const start = Number(chapter.start_time),
              end = Number(chapter.end_time);
            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              start < 0 ||
              end <= start ||
              end > duration + 0.5 ||
              end - start > 300
            )
              continue;
            if (
              /^(?:opening|intro|op)(?:\s|$|[\d:._-])/i.test(label) &&
              episode.introEnd <= episode.introStart &&
              markers.introEnd === undefined
            ) {
              markers.introStart = start;
              markers.introEnd = Math.min(end, duration);
            }
            if (
              /^(?:ending|outro|ed|end credits)(?:\s|$|[\d:._-])/i.test(label) &&
              episode.outroEnd <= episode.outroStart &&
              markers.outroEnd === undefined
            ) {
              markers.outroStart = start;
              markers.outroEnd = Math.min(end, duration);
            }
          }
        }
        await tx.episode.update({
          where: { id: upload.episodeId },
          data: { duration, ...markers },
        });
        await tx.upload.update({
          where: { id: upload.id },
          data: {
            state: 'READY',
            progress: 100,
            stageProgress: 100,
            stageDetail: 'All encrypted objects verified. Ready to publish.',
            stageBytes: BigInt(total),
            stageTotalBytes: BigInt(total),
            speedBps: 0,
            heartbeatAt: new Date(),
            error: null,
          },
        });
      });
      await safeRemove(folder).catch(() =>
        console.error('Completed media; staging cleanup needs attention.'),
      );
      await unlink(source).catch(() => {});
    } catch (error) {
      await pendingTick;
      await db.upload.update({
        where: { id: upload.id },
        data: {
          state: job.attemptsMade + 1 < (job.opts.attempts || 1) ? 'RETRYING' : 'FAILED',
          stageDetail: `${phase} interrupted; completed checkpoints retained`,
          speedBps: 0,
          error: error instanceof Error ? error.message : 'Processing failed',
          heartbeatAt: new Date(),
        },
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  },
  { connection: workerConnection, concurrency: 1, lockDuration: 120000 },
);
worker.on('failed', (job) =>
  console.error(`Media job ${job?.id} interrupted; see upload details.`),
);
worker.on('error', (error) => console.error('Media worker:', connectionReason(error)));
worker.on('stalled', (id) =>
  console.warn(`Media job ${id} stalled; queue recovery will use saved checkpoints.`),
);
// Rebuild missing Redis jobs from durable database records (including an interrupted enqueue).
let recovering = false;
async function recover() {
  if (recovering || stopping) return;
  recovering = true;
  try {
    await recoverDriveImports();
    const uploads = await db.upload.findMany({
      where: {
        state: {
          in: [
            'QUEUED',
            'VALIDATING',
            'ENCODING',
            'ENCRYPTING',
            'TRANSFERRING',
            'VERIFYING',
            'RETRYING',
          ],
        },
      },
      select: { id: true },
    });
    for (const upload of uploads) {
      const existing = await queue.getJob(upload.id);
      if (existing && (await existing.isFailed())) {
        const recoveries = Number(existing.data.restartRecoveries || 0);
        if (/stalled/i.test(existing.failedReason || '') && recoveries < 3) {
          await existing.updateData({ ...existing.data, restartRecoveries: recoveries + 1 });
          await db.upload.updateMany({
            where: { id: upload.id, state: { notIn: ['READY', 'CANCELLED', 'FAILED'] } },
            data: {
              state: 'RETRYING',
              speedBps: 0,
              stageDetail: 'Recovering interrupted queue job from saved checkpoints',
              error: null,
            },
          });
          await existing.retry('failed');
          console.log(`Recovered stalled media job ${upload.id} from checkpoints.`);
        } else {
          await db.upload.updateMany({
            where: { id: upload.id, state: { notIn: ['READY', 'CANCELLED', 'FAILED'] } },
            data: {
              state: 'FAILED',
              speedBps: 0,
              stageDetail: 'Queue processing stopped; checkpoints retained',
              error:
                'Queue recovery stopped after repeated interruptions. Use Retry from checkpoints.',
            },
          });
        }
      } else if (!existing)
        await queue.add(
          'encode',
          { uploadId: upload.id },
          {
            jobId: upload.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
    }
  } catch (error) {
    console.error('Upload recovery:', connectionReason(error));
  } finally {
    recovering = false;
  }
}
void recover();
const recoveryTimer = setInterval(() => void recover(), 60000);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(recoveryTimer);
  for (const child of children) child.kill();
  await worker.close();
  await db.$disconnect();
  await workerConnection.quit();
  await queue.close();
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log('Yoru checkpointed media worker ready');
