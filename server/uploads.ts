import {
  Body,
  Controller,
  Get,
  Param,
  Query,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { mkdir, open, stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db, dataDir, parse, queue, redis, token, audit, type AuthRequest } from './core';
import { AdminGuard } from './auth';
import { CHUNK_SIZE, digest, validateHashes, verifySource } from './upload-integrity';
import { saveArtwork } from './artwork';

@Controller('admin')
@UseGuards(AdminGuard)
export class UploadController {
  @Get('uploads') async list() {
    const terminal = ['READY', 'CANCELLED'];
    return db.upload.findMany({
      where: {
        episode: {
          title: { episodes: { some: { uploads: { some: { state: { notIn: terminal } } } } } },
        },
      },
      include: { episode: { include: { title: { select: { id: true, name: true } } } } },
      omit: { chunkHashes: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get('upload-history') async history(@Query() query: unknown) {
    const input = parse(
      z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
        page: z.coerce.number().int().min(0).max(100000).default(0),
      }),
      query,
    );
    if (!!input.start !== !!input.end || (input.start && input.end && input.start >= input.end))
      throw new BadRequestException('Choose a valid date range.');
    const rows = await db.upload.findMany({
      where: input.start
        ? { createdAt: { gte: new Date(input.start), lt: new Date(input.end!) } }
        : {},
      include: { episode: { include: { title: { select: { id: true, name: true } } } } },
      omit: { chunkHashes: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page ?? 0) * 100,
      take: 101,
    });
    return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
  }
  @Post('uploads') async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = parse(
      z.object({
        episodeId: z.string(),
        storageId: z.string(),
        filename: z.string().min(1).max(255),
        chunkHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20000),
        totalBytes: z
          .number()
          .int()
          .positive()
          .max(Number(process.env.MAX_UPLOAD_GB || 10) * 1024 ** 3),
      }),
      body,
    );
    validateHashes(input.chunkHashes, input.totalBytes);
    const episode = await db.episode.findUniqueOrThrow({
      where: { id: input.episodeId },
      include: { title: true },
    });
    if (episode.title.status === 'PUBLISHED')
      throw new ConflictException('Unpublish the title before replacing its media.');
    const storage = await db.storage.findUniqueOrThrow({ where: { id: input.storageId } });
    if (!storage.enabled) throw new BadRequestException('Storage is paused for new uploads.');
    const upload = await db.$transaction(async (tx) => {
      await tx.episode.update({ where: { id: input.episodeId }, data: { name: episode.name } });
      if (
        await tx.upload.findFirst({
          where: { episodeId: input.episodeId, state: { notIn: ['READY', 'FAILED', 'CANCELLED'] } },
        })
      )
        throw new ConflictException(
          'This episode already has an upload. Resume or cancel it first.',
        );
      return tx.upload.create({ data: { ...input, totalBytes: BigInt(input.totalBytes) } });
    });
    await mkdir(join(dataDir, 'uploads'), { recursive: true });
    await writeFile(join(dataDir, 'uploads', upload.id), Buffer.alloc(0), { mode: 0o600 });
    await audit(req.user.id, 'UPLOAD_STARTED', upload.id);
    return upload;
  }
  @Get('uploads/:id') get(@Param('id') id: string) {
    return db.upload.findUniqueOrThrow({
      where: { id },
      include: {
        episode: { include: { title: { select: { name: true } } } },
        storage: { select: { name: true, bucket: true } },
      },
    });
  }
  @Post('uploads/:id/resume') async resume(@Param('id') id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        chunkHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20000),
        totalBytes: z.number().int().positive(),
      }),
      body,
    );
    const lock = token();
    if (!(await redis.set(`upload:${id}`, lock, 'EX', 120, 'NX')))
      throw new ConflictException('Upload busy. Try again shortly.');
    let lost = false;
    const renewal = setInterval(() => {
      void redis
        .eval(
          "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('expire',KEYS[1],120) else return 0 end",
          1,
          `upload:${id}`,
          lock,
        )
        .then((ok) => {
          if (!ok) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, 30000);
    try {
      const upload = await db.upload.findUniqueOrThrow({ where: { id } });
      if (upload.state !== 'UPLOADING')
        throw new ConflictException('This upload no longer accepts source chunks.');
      if (Number(upload.totalBytes) !== input.totalBytes)
        throw new BadRequestException('Choose the original file with the same content and size.');
      validateHashes(input.chunkHashes, input.totalBytes);
      if (upload.chunkHashes.length && upload.chunkHashes.join('') !== input.chunkHashes.join(''))
        throw new BadRequestException('This is a different file. Choose the original upload.');
      if (Number(upload.receivedBytes) === 0) {
        await mkdir(join(dataDir, 'uploads'), { recursive: true });
        await writeFile(join(dataDir, 'uploads', id), Buffer.alloc(0), {
          flag: 'wx',
          mode: 0o600,
        }).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      }
      // Normal resumes compare the complete manifest and saved extent without a long HTTP scan.
      // The worker verifies every chunk before encoding. Legacy manifests need a prefix scan once.
      if ((await stat(join(dataDir, 'uploads', id))).size < Number(upload.receivedBytes))
        throw new BadRequestException(
          'Saved staging bytes are missing. Restore the staging disk before resuming.',
        );
      if (!upload.chunkHashes.length)
        await verifySource(
          join(dataDir, 'uploads', id),
          input.chunkHashes,
          Number(upload.receivedBytes),
        );
      if (lost) throw new ConflictException('Upload lock interrupted. Please retry.');
      if (!upload.chunkHashes.length)
        await db.upload.update({ where: { id }, data: { chunkHashes: input.chunkHashes } });
      return await db.upload.findUniqueOrThrow({ where: { id } });
    } finally {
      clearInterval(renewal);
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        `upload:${id}`,
        lock,
      );
    }
  }
  @Post('uploads/:id/chunk') async chunk(@Param('id') id: string, @Req() req: AuthRequest) {
    const lock = token();
    if (!(await redis.set(`upload:${id}`, lock, 'EX', 120, 'NX')))
      throw new ConflictException('Upload busy. Retry this chunk.');
    try {
      const upload = await db.upload.findUniqueOrThrow({ where: { id } });
      if (upload.state !== 'UPLOADING')
        throw new ConflictException('Upload is already processing.');
      const offset = Number(req.headers['upload-offset']);
      const bytes = req.body;
      if (
        !Buffer.isBuffer(bytes) ||
        !bytes.length ||
        bytes.length > 8 * 1024 * 1024 ||
        !Number.isSafeInteger(offset) ||
        offset > Number(upload.receivedBytes) ||
        offset < 0 ||
        offset % CHUNK_SIZE !== 0 ||
        offset + bytes.length > Number(upload.totalBytes)
      )
        throw new BadRequestException(
          'Invalid chunk or offset. Resume from the saved server offset.',
        );
      if (bytes.length !== Math.min(CHUNK_SIZE, Number(upload.totalBytes) - offset))
        throw new BadRequestException('Send one complete upload chunk.');
      const expected = upload.chunkHashes[offset / CHUNK_SIZE];
      if (!expected || digest(bytes) !== expected)
        throw new BadRequestException(
          'Chunk checksum mismatch. No bytes acknowledged; resend the original chunk.',
        );
      // A response can be lost after commit. Re-sending that exact chunk is safe.
      if (offset < Number(upload.receivedBytes)) return upload;
      const handle = await open(join(dataDir, 'uploads', upload.id), 'r+');
      try {
        if ((await handle.stat()).size < offset)
          throw new BadRequestException(
            'Saved staging data is missing. Restore the staging disk before resuming.',
          );
        await handle.truncate(offset);
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(
            bytes,
            written,
            bytes.length - written,
            offset + written,
          );
          written += result.bytesWritten;
          if (!result.bytesWritten) throw new Error('Unable to persist upload bytes.');
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      return await db.upload.update({
        where: { id },
        data: {
          receivedBytes: BigInt(offset + bytes.length),
          progress: Math.floor(((offset + bytes.length) / Number(upload.totalBytes)) * 100),
          stageProgress: ((offset + bytes.length) / Number(upload.totalBytes)) * 100,
          stageBytes: BigInt(offset + bytes.length),
          stageTotalBytes: upload.totalBytes,
          stageDetail: `Saved and verified chunk ${offset / CHUNK_SIZE + 1} of ${upload.chunkHashes.length}`,
          speedBps:
            bytes.length /
            Math.max(
              0.001,
              (Date.now() -
                ((req as AuthRequest & { uploadStartedAt?: number }).uploadStartedAt ||
                  Date.now())) /
                1000,
            ),
          heartbeatAt: new Date(),
        },
      });
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        `upload:${id}`,
        lock,
      );
    }
  }
  @Post('uploads/:id/complete') async complete(@Param('id') id: string) {
    const lock = token();
    if (!(await redis.set(`upload:${id}`, lock, 'EX', 120, 'NX')))
      throw new ConflictException('Upload busy. Try again shortly.');
    try {
      const upload = await db.upload.findUniqueOrThrow({
        where: { id },
        include: { episode: { include: { title: true } } },
      });
      if (upload.episode.title.status === 'PUBLISHED')
        throw new ConflictException('Unpublish before starting media processing.');
      if (
        await db.upload.findFirst({
          where: {
            episodeId: upload.episodeId,
            createdAt: { gt: upload.createdAt },
            state: { not: 'CANCELLED' },
          },
        })
      )
        throw new ConflictException(
          'A newer upload exists for this episode. Use the newer upload.',
        );
      if (!['UPLOADING', 'FAILED', 'QUEUED'].includes(upload.state))
        throw new ConflictException('Upload is already processing or finished.');
      const sourceSize = await stat(join(dataDir, 'uploads', upload.id))
        .then((file) => file.size)
        .catch(() => -1);
      if (upload.receivedBytes !== upload.totalBytes || sourceSize !== Number(upload.totalBytes)) {
        const imported = await db.driveImport.findUnique({ where: { uploadId: id } });
        if (!imported)
          throw new BadRequestException(
            'The source file is missing or incomplete after restart. Select the original file to resume uploading before retrying processing.',
          );
        const mediaJob = await queue.getJob(id);
        if (mediaJob && (await mediaJob.isActive()))
          throw new ConflictException('Media processing is still running. Try again shortly.');
        const driveJob = await queue.getJob(`drive-${imported.id}`);
        if (driveJob && !(await driveJob.isFailed()) && !(await driveJob.isCompleted()))
          throw new ConflictException('Drive source recovery is already queued or running.');
        if (mediaJob) await mediaJob.remove();
        if (driveJob) await driveJob.remove();
        await db.$transaction([
          db.upload.update({
            where: { id },
            data: {
              state: 'UPLOADING',
              error: null,
              receivedBytes: 0n,
              chunkHashes: [],
              progress: 0,
              stageProgress: 0,
              stageBytes: 0n,
              speedBps: 0,
              stageDetail: 'Restoring lost source from Google Drive after rebuild',
              heartbeatAt: new Date(),
            },
          }),
          db.driveImport.update({
            where: { id: imported.id },
            data: { state: 'QUEUED', error: null },
          }),
        ]);
        await queue.add(
          'drive-import',
          { importId: imported.id },
          {
            jobId: `drive-${imported.id}`,
            priority: 10,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: 100,
          },
        );
        return { ok: true, recoveringSource: true };
      }
      const old = await queue.getJob(id);
      if (old && ((await old.isFailed()) || (await old.isCompleted()))) await old.remove();
      await db.upload.update({
        where: { id },
        data: {
          state: 'QUEUED',
          error: null,
          progress: 0,
          stageProgress: 0,
          speedBps: 0,
          stageDetail: 'Source saved. Waiting for a media worker.',
          heartbeatAt: new Date(),
        },
      });
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
      return { ok: true };
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        `upload:${id}`,
        lock,
      );
    }
  }
  @Post('uploads/:id/cancel') async cancel(@Param('id') id: string) {
    const lock = token();
    if (!(await redis.set(`upload:${id}`, lock, 'EX', 120, 'NX')))
      throw new ConflictException('A chunk is being written. Try again shortly.');
    try {
      const upload = await db.upload.findUniqueOrThrow({ where: { id } });
      if (!['UPLOADING', 'FAILED', 'QUEUED'].includes(upload.state))
        throw new ConflictException('Wait for processing to finish before replacing this media.');
      const job = await queue.getJob(id);
      if (job) {
        if (await job.isActive())
          throw new ConflictException('This job is running. Wait for it to finish.');
        await job.remove();
      }
      await db.upload.update({ where: { id }, data: { state: 'CANCELLED', error: null } });
      await unlink(join(dataDir, 'uploads', upload.id)).catch(() => {});
      return { ok: true };
    } finally {
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        `upload:${id}`,
        lock,
      );
    }
  }
  @Post('artwork')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async artwork(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an image.');
    const b = file.buffer;
    let ext = '';
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ext = 'png';
    else if (b[0] === 255 && b[1] === 216 && b[2] === 255) ext = 'jpg';
    else if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')
      ext = 'webp';
    if (!ext) throw new BadRequestException('Use PNG, JPEG or WebP artwork.');
    await mkdir(join(dataDir, 'artwork'), { recursive: true });
    const name = `${token()}.${ext}`;
    await saveArtwork(name, b);
    return { url: `/api/artwork/${name}` };
  }
}
