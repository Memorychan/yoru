import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import {
  db,
  redis,
  token,
  seal,
  unseal,
  parse,
  origin,
  queue,
  dataDir,
  audit,
  type AuthRequest,
} from './core';
import { AdminGuard } from './auth';
import { CHUNK_SIZE, digest } from './upload-integrity';
const scope = 'https://www.googleapis.com/auth/drive.readonly';
const redirect = () => `${origin.replace(/\/$/, '')}/api/admin/drive/callback`;
function config() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    throw new BadRequestException(
      'Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Space secrets first.',
    );
  return {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
async function access(adminId: string) {
  const connection = await db.driveConnection.findUnique({ where: { id: adminId } });
  if (!connection) throw new BadRequestException('Connect your Google Drive account first.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      ...config(),
      grant_type: 'refresh_token',
      refresh_token: unseal(connection.tokenEncrypted),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new BadRequestException('Google authorization expired or was revoked. Reconnect Drive.');
  return String((await response.json()).access_token);
}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  capabilities?: { canDownload?: boolean };
  path?: string;
  season?: number;
}
const fields = 'id,name,mimeType,size,md5Checksum,modifiedTime,capabilities(canDownload)';
async function google(path: string, bearer: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new BadRequestException(
      response.status === 403
        ? 'Google Drive denied access or reached a download/API limit.'
        : 'Google Drive file could not be accessed. Check sharing and reconnect if necessary.',
    );
  return response.json();
}
function folderId(value: string) {
  const id = /\/folders\/([\w-]+)/.exec(value)?.[1] || value.trim();
  if (!/^[\w-]{10,200}$/.test(id))
    throw new BadRequestException('Paste a Google Drive folder link or ID.');
  return id;
}
@Controller('admin/drive')
@UseGuards(AdminGuard)
export class DriveController {
  @Get('status') async status(@Req() req: AuthRequest) {
    return {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      connected: !!(await db.driveConnection.findUnique({ where: { id: req.user.id } })),
    };
  }
  @Post('connect') async connect(@Req() req: AuthRequest) {
    const { client_id } = config();
    const state = token();
    await redis.set(`drive-oauth:${state}`, req.user.id, 'EX', 600);
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id, redirect_uri: redirect(), response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state })}`,
    };
  }
  @Get('callback') async callback(
    @Req() req: AuthRequest,
    @Query('state') state: string,
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!state || !/^[a-f0-9]{64}$/.test(state) || !code)
      return res.redirect(`${origin}/admin?section=drive&drive=denied`);
    const owner = await redis.getdel(`drive-oauth:${state}`);
    if (owner !== req.user.id)
      throw new BadRequestException('Google authorization request expired. Connect again.');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        ...config(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirect(),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return res.redirect(`${origin}/admin?section=drive&drive=failed`);
    const result = await response.json();
    if (
      !result.refresh_token ||
      !String(result.scope || '')
        .split(' ')
        .includes(scope)
    )
      return res.redirect(`${origin}/admin?section=drive&drive=failed`);
    await db.driveConnection.upsert({
      where: { id: req.user.id },
      create: { id: req.user.id, tokenEncrypted: seal(result.refresh_token) },
      update: { tokenEncrypted: seal(result.refresh_token) },
    });
    await audit(req.user.id, 'DRIVE_CONNECTED', req.user.id);
    return res.redirect(`${origin}/admin?section=drive&drive=connected`);
  }
  @Post('disconnect') async disconnect(@Req() req: AuthRequest) {
    await db.driveConnection.deleteMany({ where: { id: req.user.id } });
    await audit(req.user.id, 'DRIVE_DISCONNECTED', req.user.id);
    return { ok: true };
  }
  @Post('preview') async preview(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = parse(z.object({ folder: z.string().max(2000) }), body);
    const bearer = await access(req.user.id);
    const root = folderId(input.folder);
    const folder = await google(
      `files/${root}?supportsAllDrives=true&fields=id,name,mimeType`,
      bearer,
    );
    if (folder.mimeType !== 'application/vnd.google-apps.folder')
      throw new BadRequestException('Choose a folder.');
    const rootSeason = /(?:season|\bs)\s*0*(\d+)/i.exec(folder.name)?.[1];
    const todo = [{ id: root, path: folder.name, season: rootSeason ? Number(rootSeason) : 1 }];
    const visited = new Set<string>();
    const files: DriveFile[] = [];
    let folders = 0;
    while (todo.length) {
      const parent = todo.shift()!;
      if (visited.has(parent.id)) continue;
      visited.add(parent.id);
      if (++folders > 200)
        throw new BadRequestException(
          'Folder preview is limited to 200 folders. Choose a smaller folder.',
        );
      let page = '';
      do {
        const params = new URLSearchParams({
          q: `'${parent.id}' in parents and trashed = false`,
          fields: `nextPageToken,incompleteSearch,files(${fields})`,
          pageSize: '100',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        });
        if (page) params.set('pageToken', page);
        const result = await google(`files?${params}`, bearer);
        if (result.incompleteSearch)
          throw new BadRequestException(
            'Drive returned an incomplete listing. Choose a smaller folder.',
          );
        for (const file of result.files as DriveFile[]) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            const season = /(?:season|\bs)\s*0*(\d+)/i.exec(file.name)?.[1];
            todo.push({
              id: file.id,
              path: `${parent.path}/${file.name}`,
              season: season ? Number(season) : parent.season,
            });
          } else {
            files.push({ ...file, path: `${parent.path}/${file.name}`, season: parent.season });
          }
          if (files.length + todo.length > 3000)
            throw new BadRequestException(
              'Preview is limited to 3000 files. Choose a smaller season folder.',
            );
        }
        page = result.nextPageToken || '';
      } while (page);
    }
    files.sort((a, b) => a.path!.localeCompare(b.path!, undefined, { numeric: true }));
    const inventory = token();
    await redis.set(
      `drive-preview:${req.user.id}:${inventory}`,
      seal(JSON.stringify(files)),
      'EX',
      1800,
    );
    return {
      inventory,
      folder: folder.name,
      folders,
      files: files.map((file) => ({ ...file, eligible: eligible(file) })),
      totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
    };
  }
  @Get('imports') async imports(@Req() req: AuthRequest) {
    const rows = await db.driveImport.findMany({
      where: { adminId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        upload: await db.upload.findUnique({ where: { id: row.uploadId } }),
      })),
    );
  }
  @Post('approve') async approve(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = parse(
      z.object({
        inventory: z.string().regex(/^[a-f0-9]{64}$/),
        titleId: z.string(),
        storageId: z.string(),
        files: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().trim().min(1).max(200),
              season: z.number().int().min(1).max(1000),
              number: z.number().int().min(1).max(10000),
            }),
          )
          .min(1)
          .max(300),
      }),
      body,
    );
    const snapshot = await redis.get(`drive-preview:${req.user.id}:${input.inventory}`);
    if (!snapshot) throw new BadRequestException('Preview expired. Scan the folder again.');
    const saved = JSON.parse(unseal(snapshot)) as DriveFile[];
    if (
      new Set(input.files.map((f) => f.id)).size !== input.files.length ||
      new Set(input.files.map((f) => `${f.season}:${f.number}`)).size !== input.files.length
    )
      throw new BadRequestException('File selections and season/episode numbers must be unique.');
    const files = input.files.map((file) => {
      const record = saved.find((item) => item.id === file.id);
      if (!record || !eligible(record))
        throw new BadRequestException('Select only downloadable video files from the preview.');
      return { ...file, record: record! };
    });
    const storage = await db.storage.findUniqueOrThrow({ where: { id: input.storageId } });
    if (!storage.enabled) throw new BadRequestException('Storage is paused.');
    await access(req.user.id);
    const created = await db.$transaction(async (tx) => {
      const title = await tx.title.update({
        where: { id: input.titleId },
        data: { updatedAt: new Date() },
      });
      if (title.status !== 'DRAFT')
        throw new ConflictException('Unpublish the destination before importing.');
      if (
        title.format === 'MOVIE' &&
        (files.length !== 1 || files[0].season !== 1 || files[0].number !== 1)
      )
        throw new BadRequestException(
          'Movies accept one file, season 1 / entry 1. Use Series for seasons.',
        );
      const rows = [];
      for (const file of files) {
        let episode = await tx.episode.findFirst({
          where: { titleId: title.id, season: file.season, number: file.number },
          include: { asset: true, uploads: true },
        });
        if (
          episode &&
          (episode.asset ||
            episode.uploads.some((upload) => !['FAILED', 'CANCELLED'].includes(upload.state)))
        )
          throw new ConflictException(
            `Season ${file.season}, episode ${file.number} already has media or an upload.`,
          );
        if (!episode)
          episode = await tx.episode.create({
            data: { titleId: title.id, season: file.season, number: file.number, name: file.name },
            include: { asset: true, uploads: true },
          });
        else await tx.episode.update({ where: { id: episode.id }, data: { name: file.name } });
        const upload = await tx.upload.create({
          data: {
            episodeId: episode.id,
            storageId: input.storageId,
            filename: file.record.name,
            totalBytes: BigInt(file.record.size!),
            stageDetail: 'Approved Google Drive import; waiting for worker',
          },
        });
        rows.push(
          await tx.driveImport.create({
            data: {
              adminId: req.user.id,
              uploadId: upload.id,
              fileId: file.id,
              expected: JSON.parse(JSON.stringify(file.record)),
            },
          }),
        );
      }
      return rows;
    });
    for (const row of created)
      await queue.add(
        'drive-import',
        { importId: row.id },
        {
          jobId: `drive-${row.id}`,
          priority: 10,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100,
        },
      );
    await audit(req.user.id, 'DRIVE_IMPORT_APPROVED', input.titleId);
    return { count: created.length };
  }
  @Post('imports/:id/retry') async retry(@Req() req: AuthRequest, @Param('id') id: string) {
    const row = await db.driveImport.findFirst({ where: { id, adminId: req.user.id } });
    if (!row || row.state !== 'FAILED')
      throw new BadRequestException('Only failed imports can be retried.');
    const job = await queue.getJob(`drive-${id}`);
    if (job && !(await job.isFailed()) && !(await job.isCompleted()))
      throw new ConflictException('Import is already running or retrying.');
    if (job) await job.remove();
    await db.driveImport.update({ where: { id }, data: { state: 'QUEUED', error: null } });
    await queue.add(
      'drive-import',
      { importId: id },
      {
        jobId: `drive-${id}`,
        priority: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
      },
    );
    return { ok: true };
  }
}
function eligible(file: DriveFile) {
  const size = Number(file.size || 0);
  return (
    file.capabilities?.canDownload === true &&
    (file.mimeType.startsWith('video/') || /\.(mkv|mp4|mov|avi|webm|m4v)$/i.test(file.name)) &&
    size > 0 &&
    size <= Number(process.env.MAX_UPLOAD_GB || 10) * 1024 ** 3
  );
}
export async function processDriveImport(id: string) {
  const task = await db.driveImport.findUniqueOrThrow({ where: { id } });
  if (task.state === 'DONE') return;
  const upload = await db.upload.findUniqueOrThrow({ where: { id: task.uploadId } });
  if (upload.state === 'CANCELLED') {
    await db.driveImport.update({ where: { id }, data: { state: 'CANCELLED' } });
    return;
  }
  if (
    [
      'QUEUED',
      'VALIDATING',
      'ENCODING',
      'ENCRYPTING',
      'TRANSFERRING',
      'VERIFYING',
      'READY',
    ].includes(upload.state)
  ) {
    await finishImport(id, upload.id);
    return;
  }
  const expected = task.expected as unknown as DriveFile;
  try {
    if (
      await db.upload.findFirst({
        where: {
          episodeId: upload.episodeId,
          createdAt: { gt: upload.createdAt },
          state: { not: 'CANCELLED' },
        },
      })
    )
      throw new Error(
        'A newer upload exists for this episode. Cancel this older import and use the newer upload.',
      );
    await db.driveImport.update({ where: { id }, data: { state: 'DOWNLOADING', error: null } });
    let bearer = await access(task.adminId);
    const metadata = (await google(
      `files/${task.fileId}?supportsAllDrives=true&fields=${fields}`,
      bearer,
    )) as DriveFile;
    if (
      !eligible(metadata) ||
      metadata.size !== expected.size ||
      metadata.modifiedTime !== expected.modifiedTime ||
      metadata.md5Checksum !== expected.md5Checksum
    )
      throw new Error(
        'Drive file changed after preview or downloading is blocked. Scan and approve it again.',
      );
    await mkdir(join(dataDir, 'uploads'), { recursive: true });
    const local = join(dataDir, 'uploads', upload.id);
    const disk = await statfs(dataDir);
    if (disk.bavail * disk.bsize < Number(expected.size) * 3)
      throw new Error(
        'Insufficient temporary disk space. Free space or import a smaller video; conversion needs additional space.',
      );
    let offset = Number(upload.receivedBytes);
    let hashes = [...upload.chunkHashes];
    let size = 0;
    try {
      size = (await stat(local)).size;
    } catch {}
    if (size < offset) {
      offset = 0;
      hashes = [];
    }
    const handle = await open(local, 'a+');
    try {
      await handle.truncate(offset);
      await db.upload.update({
        where: { id: upload.id },
        data: {
          state: 'UPLOADING',
          receivedBytes: BigInt(offset),
          chunkHashes: hashes,
          error: null,
        },
      });
      while (offset < Number(expected.size)) {
        const current = await db.upload.findUniqueOrThrow({ where: { id: upload.id } });
        if (current.state === 'CANCELLED') {
          await db.driveImport.update({ where: { id }, data: { state: 'CANCELLED' } });
          return;
        }
        const end = Math.min(offset + CHUNK_SIZE, Number(expected.size)) - 1;
        const began = Date.now();
        let response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${task.fileId}?alt=media&supportsAllDrives=true`,
          {
            headers: { Authorization: `Bearer ${bearer}`, Range: `bytes=${offset}-${end}` },
            signal: AbortSignal.timeout(120000),
          },
        );
        if (response.status === 401) {
          bearer = await access(task.adminId);
          response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${task.fileId}?alt=media&supportsAllDrives=true`,
            {
              headers: { Authorization: `Bearer ${bearer}`, Range: `bytes=${offset}-${end}` },
              signal: AbortSignal.timeout(120000),
            },
          );
        }
        if (
          response.status !== 206 ||
          response.headers.get('content-range') !== `bytes ${offset}-${end}/${expected.size}`
        ) {
          await response.body?.cancel();
          throw new Error(
            'Drive download denied, rate-limited, or did not return the requested byte range.',
          );
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== end - offset + 1) throw new Error('Incomplete Drive chunk.');
        // Append and flush before acknowledging bytes in the database.
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written);
          if (!result.bytesWritten) throw new Error('Source write interrupted.');
          written += result.bytesWritten;
        }
        await handle.sync();
        hashes.push(digest(bytes));
        offset += bytes.length;
        await db.upload.update({
          where: { id: upload.id },
          data: {
            receivedBytes: BigInt(offset),
            chunkHashes: hashes,
            stageBytes: BigInt(offset),
            stageTotalBytes: BigInt(expected.size!),
            stageProgress: (offset / Number(expected.size)) * 100,
            speedBps: bytes.length / Math.max(0.001, (Date.now() - began) / 1000),
            heartbeatAt: new Date(),
            stageDetail: 'Downloading approved source from Google Drive',
          },
        });
      }
    } finally {
      await handle.close();
    }
    if (expected.md5Checksum) {
      const sum = createHash('md5');
      for await (const chunk of createReadStream(local)) sum.update(chunk);
      if (sum.digest('hex') !== expected.md5Checksum) {
        await db.upload.update({
          where: { id: upload.id },
          data: { receivedBytes: 0n, chunkHashes: [] },
        });
        throw new Error('Drive source checksum mismatch. Retry to download it again.');
      }
    }
    const latest = await google(
      `files/${task.fileId}?supportsAllDrives=true&fields=${fields}`,
      await access(task.adminId),
    );
    if (latest.modifiedTime !== expected.modifiedTime || latest.size !== expected.size)
      throw new Error('Drive file changed during download.');
    const queued = await db.upload.updateMany({
      where: { id: upload.id, state: 'UPLOADING' },
      data: {
        state: 'QUEUED',
        speedBps: 0,
        stageDetail: 'Drive download verified; queued for processing',
      },
    });
    if (!queued.count) {
      await db.driveImport.update({ where: { id }, data: { state: 'CANCELLED' } });
      return;
    }
    await finishImport(id, upload.id);
  } catch (error) {
    const message =
      error instanceof Error && !/https?:|token|fetch failed/i.test(error.message)
        ? error.message.slice(0, 300)
        : 'Drive connection interrupted. Reconnect if required and retry; saved chunks are retained.';
    await db.driveImport.update({ where: { id }, data: { state: 'FAILED', error: message } });
    await db.upload.updateMany({
      where: { id: upload.id, state: { notIn: ['CANCELLED', 'READY'] } },
      data: { state: 'FAILED', error: message, speedBps: 0 },
    });
    throw new Error('Google Drive import interrupted.');
  }
}
async function finishImport(id: string, uploadId: string) {
  const upload = await db.upload.findUniqueOrThrow({ where: { id: uploadId } });
  if (upload.state !== 'READY')
    await queue.add(
      'encode',
      { uploadId },
      {
        jobId: uploadId,
        priority: 1,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  await db.driveImport.update({ where: { id }, data: { state: 'DONE', error: null } });
}
export async function recoverDriveImports() {
  const rows = await db.driveImport.findMany({
    where: { state: { in: ['QUEUED', 'DOWNLOADING'] } },
  });
  for (const row of rows) {
    const job = await queue.getJob(`drive-${row.id}`);
    if (job && (await job.isFailed())) {
      await db.driveImport.update({
        where: { id: row.id },
        data: {
          state: 'FAILED',
          error: 'Import worker interrupted repeatedly. Use Retry download to continue.',
        },
      });
      continue;
    }
    if (!job)
      await queue.add(
        'drive-import',
        { importId: row.id },
        {
          jobId: `drive-${row.id}`,
          priority: 10,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100,
        },
      );
  }
}
