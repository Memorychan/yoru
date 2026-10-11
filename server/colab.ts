import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { mkdir, stat, readFile, readdir, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Response } from 'express';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { AdminGuard } from './auth';
import { db, redis, queue, token, hash, dataDir, parse, type AuthRequest } from './core';
import { checkpoint, saveCheckpoint, durableWrite, recordRendition } from './media-checkpoint';
import { digest } from './upload-integrity';

@Controller('admin/colab')
@UseGuards(AdminGuard)
export class ColabAdminController {
  @Post('release/:id') async release(@Param('id') id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new BadRequestException();
    if (await redis.exists(`colab-finish:${id}`))
      throw new BadRequestException('Rendition handoff is in progress. Wait before releasing.');
    const result = await db.upload.updateMany({
      where: { id, state: 'COLAB_ENCODING' },
      data: {
        state: 'FAILED',
        error: 'Colab processing released. Retry processing to use the local worker.',
        stageDetail: 'Colab reservation released',
      },
    });
    if (!result.count) throw new BadRequestException('No active Colab reservation.');
    await redis.del(`colab-job:${id}`);
    const folder = join(dataDir, 'processing', id);
    await mkdir(folder, { recursive: true });
    await durableWrite(join(folder, 'colab-local'), 'local');
    return { ok: true };
  }
  @Post('connect') async connect(@Req() req: AuthRequest) {
    const key = token();
    await redis.set(`colab-key:${hash(key)}`, req.user.id, 'EX', 86400);
    await redis.set('colab:enabled', hash(key), 'EX', 86400);
    return { key, expiresInHours: 24 };
  }
  @Post('revoke') async revoke(@Body() body: unknown, @Req() req: AuthRequest) {
    const { key } = parse(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/) }), body);
    if ((await redis.get(`colab-key:${hash(key)}`)) !== req.user.id) throw new ForbiddenException();
    await redis.del(`colab-key:${hash(key)}`);
    if ((await redis.get('colab:enabled')) === hash(key)) await redis.del('colab:enabled');
    return { ok: true };
  }
}
@Injectable()
class ColabGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const key = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    if (!key) throw new ForbiddenException();
    const owner = await redis.get(`colab-key:${hash(key)}`);
    const user = owner ? await db.user.findUnique({ where: { id: owner } }) : null;
    if (!user || user.disabled || user.role !== 'ADMIN')
      throw new ForbiddenException('Colab connection expired. Create a new connection key.');
    req.user = user;
    return true;
  }
}
async function leased(id: string, req: AuthRequest) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new BadRequestException();
  const owner = await redis.get(`colab-job:${id}`);
  if (
    owner !==
    `${hash(req.headers.authorization || '')}:${String(req.headers['x-yoru-colab-lease'] || '')}`
  )
    throw new ForbiddenException('Colab job lease expired. Reclaim the job.');
  const row = await db.upload.findUniqueOrThrow({ where: { id } });
  if (row.state !== 'COLAB_ENCODING')
    throw new BadRequestException('Job is no longer reserved for Colab.');
  return row;
}
function probe(source: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFPROBE_BIN || 'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source],
      { windowsHide: true },
    );
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new BadRequestException('Source probe timed out.'));
    }, 30000);
    child.stdout.on('data', (bytes) => {
      output += bytes;
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new BadRequestException('Source probe failed.'));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code) return reject(new BadRequestException('Source probe failed.'));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new BadRequestException('Invalid source metadata.'));
      }
    });
  });
}
@Controller('colab')
@UseGuards(ColabGuard)
export class ColabController {
  @Post('claim') async claim(@Req() req: AuthRequest) {
    const candidates = await db.upload.findMany({
      where: {
        state: { in: ['QUEUED', 'COLAB_ENCODING'] },
        episode: { title: { status: 'DRAFT' } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const row of candidates) {
      if (!(await redis.set(`colab-claim:${row.id}`, '1', 'EX', 30, 'NX'))) continue;
      try {
        if (await redis.exists(`colab-job:${row.id}`)) continue;
        const source = join(dataDir, 'uploads', row.id);
        if (
          (await stat(source)
            .then((s) => s.size)
            .catch(() => -1)) !== Number(row.totalBytes)
        ) {
          await db.upload.updateMany({
            where: { id: row.id, state: row.state },
            data: {
              state: 'FAILED',
              error:
                'Source missing after rebuild. Click Retry processing to restore the Drive source.',
              stageDetail: 'Source recovery needed',
            },
          });
          continue;
        }
        const job = await queue.getJob(row.id);
        if (job) {
          if (await job.isActive()) continue;
          try {
            await job.remove();
          } catch {
            continue;
          }
        }
        const changed = await db.upload.updateMany({
          where: { id: row.id, state: row.state },
          data: {
            state: 'COLAB_ENCODING',
            error: null,
            stageProgress: 0,
            stageDetail: 'Reserved for Colab GPU rendition',
            heartbeatAt: new Date(),
          },
        });
        if (!changed.count) continue;
        const lease = token();
        await redis.set(
          `colab-job:${row.id}`,
          `${hash(req.headers.authorization || '')}:${lease}`,
          'EX',
          900,
        );
        return {
          id: row.id,
          lease,
          filename: row.filename,
          totalBytes: String(row.totalBytes),
          chunkHashes: row.chunkHashes,
        };
      } finally {
        await redis.del(`colab-claim:${row.id}`);
      }
    }
    return { idle: true };
  }
  @Get(':id/source') async source(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const row = await leased(id, req);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(row.totalBytes));
    res.type('application/octet-stream');
    const stream = createReadStream(join(dataDir, 'uploads', id));
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  @Post(':id/heartbeat') async heartbeat(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    await leased(id, req);
    const input = parse(
      z.object({ progress: z.number().min(0).max(100), detail: z.string().max(160) }),
      body,
    );
    await redis.expire(`colab-job:${id}`, 900);
    await db.upload.updateMany({
      where: { id, state: 'COLAB_ENCODING' },
      data: { stageProgress: input.progress, stageDetail: input.detail, heartbeatAt: new Date() },
    });
    return { ok: true };
  }
  @Post(':id/files/:name')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024, files: 1 } }))
  async file(
    @Param('id') id: string,
    @Param('name') name: string,
    @Req() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await leased(id, req);
    if (!file || !/^(?:v\d{1,4}|audio\d)(?:-\d{5,8}\.ts|\.m3u8)$/.test(name))
      throw new BadRequestException('Invalid rendition file.');
    const folder = join(dataDir, 'colab', id);
    try {
      await mkdir(folder, { recursive: true });
      const existing = await readdir(folder);
      if (!existing.includes(name) && existing.length >= 20000)
        throw new BadRequestException('Too many rendition files.');
      // A retry of an acknowledged file need not write and sync it again.
      const target = join(folder, name);
      const saved = await readFile(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!saved || digest(saved) !== digest(file.buffer)) await durableWrite(target, file.buffer);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = (error as NodeJS.ErrnoException).code || 'UNKNOWN';
      console.error('Colab rendition write failed', { uploadId: id, file: name, code });
      if (['ENOSPC', 'EDQUOT'].includes(code))
        throw new HttpException('Space staging disk is full. Free storage before retrying; Colab renditions are retained.', 507);
      throw new HttpException(`Could not save rendition ${name} (${code}). Check Space container logs and retry.`, 503);
    }
    return { hash: digest(file.buffer) };
  }
  @Post(':id/complete') async complete(@Param('id') id: string, @Req() req: AuthRequest) {
    const row = await leased(id, req);
    if (!(await redis.set(`colab-finish:${id}`, '1', 'EX', 900, 'NX')))
      throw new BadRequestException('Rendition handoff is already running.');
    try {
      const metadata = await probe(join(dataDir, 'uploads', id));
      const video = metadata.streams.find((s: any) => s.codec_type === 'video');
      if (!video) throw new BadRequestException('No video stream.');
      const heights = [360, 720, 1080].filter((h) => h <= video.height);
      if (!heights.length) heights.push(Math.max(2, Math.floor(video.height / 2) * 2));
      const names = [
        ...metadata.streams
          .filter((s: any) => s.codec_type === 'audio')
          .slice(0, 8)
          .map((_: any, i: number) => `audio${i}`),
        ...heights.map((h) => `v${h}`),
      ];
      const folder = join(dataDir, 'colab', id),
        destination = join(dataDir, 'processing', id);
      const expected = new Set<string>();
      for (const name of names) {
        const playlist = await readFile(join(folder, `${name}.m3u8`), 'utf8');
        if (
          !playlist.startsWith('#EXTM3U') ||
          !playlist.includes('#EXT-X-ENDLIST') ||
          /URI\s*=/.test(playlist)
        )
          throw new BadRequestException('Invalid rendition playlist.');
        const segments = playlist.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
        if (
          !segments.length ||
          segments.some((file) => !new RegExp(`^${name}-\\d{5,8}\\.ts$`).test(file))
        )
          throw new BadRequestException('Invalid segment references.');
        const seconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
          (n, m) => n + Number(m[1]),
          0,
        );
        if (Math.abs(seconds - Number(metadata.format.duration)) > 12)
          throw new BadRequestException('Rendition duration differs from source.');
        expected.add(`${name}.m3u8`);
        for (const segment of segments) {
          if (!(await stat(join(folder, segment))).size)
            throw new BadRequestException('Empty segment.');
          expected.add(segment);
        }
      }
      await mkdir(destination, { recursive: true });
      const saved = await checkpoint(destination, id);
      // New GPU output must never reuse ciphertext from an older CPU rendition.
      saved.segments = {};
      saved.renditions = {};
      saved.manifest = { master: '', playlists: {}, files: {} };
      saved.prefix = token();
      for (const old of await readdir(destination)) {
        if (/^(?:v\d{1,4}|audio\d)(?:-\d{5,8}\.ts|\.m3u8)$/.test(old))
          await unlink(join(destination, old));
      }
      for (const file of expected)
        await durableWrite(join(destination, file), await readFile(join(folder, file)));
      for (const name of names) saved.renditions[name] = await recordRendition(destination, name);
      await saveCheckpoint(destination, saved);
      await durableWrite(join(destination, 'colab-ready'), 'ready');
      await leased(id, req);
      const changed = await db.upload.updateMany({
        where: { id, state: 'COLAB_ENCODING' },
        data: {
          state: 'QUEUED',
          stageDetail: 'Colab renditions received; queued for encryption and HF transfer',
          heartbeatAt: new Date(),
        },
      });
      if (!changed.count) throw new BadRequestException('Job reservation changed during handoff.');
      await queue.add(
        'encode',
        { uploadId: id },
        {
          jobId: id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      await redis.del(`colab-job:${id}`);
      // The validated ID confines this folder to data/colab. Processing now owns a
      // durable copy; keep it if queuing failed, remove only after successful handoff.
      await rm(folder, { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) =>
        console.error('Colab staging cleanup failed', { uploadId: id, code: error.code }),
      );
      return { ok: true };
    } finally {
      await redis.del(`colab-finish:${id}`);
    }
  }
}
