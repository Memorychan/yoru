import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  db,
  token,
  hash,
  dataDir,
  requireWatch,
  unseal,
  decrypt,
  encrypt,
  parse,
  redis,
  origin,
  type AuthRequest,
  type MediaManifest,
} from './core';
import { AdminGuard, MemberGuard } from './auth';
import { hf, hfForStorage } from './storage';
import { cacheCipher, cachedCipher, forgetCipher } from './media-cache';
const inFlight = new Map<string, Promise<Buffer>>();
type PlaybackStorage = { id: string; bucket: string; tokenEncrypted: string };
let prefetching = 0;
function prefetch(file: string, manifest: MediaManifest, storage: PlaybackStorage) {
  const match = /^(.*-)(\d+)\.ts$/.exec(file);
  if (!match) return;
  for (let offset = 1; offset <= 2 && prefetching < 2; offset++) {
    const name = `${match[1]}${String(Number(match[2]) + offset).padStart(match[2].length, '0')}.ts`;
    const segment = manifest.files[name];
    if (!segment) continue;
    const key = `media:${hash(storage.bucket + segment.object)}`;
    if (cachedCipher(key) || inFlight.has(key)) continue;
    prefetching++;
    void ciphertext(segment.object, storage, true)
      .catch(() => {})
      .finally(() => {
        prefetching--;
      });
  }
}
async function ciphertext(object: string, storage: PlaybackStorage, prefetch = false) {
  const key = `media:${hash(storage.bucket + object)}`;
  const cached = cachedCipher(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;
  const pending = (async () => {
    await mkdir(join(dataDir, 'fetch'), { recursive: true });
    const local = join(dataDir, 'fetch', token());
    try {
      await hfForStorage(storage.id, {
        op: 'download',
        object,
        local,
        prefetch,
      });
      const bytes = await readFile(local);
      cacheCipher(key, bytes);
      return bytes;
    } finally {
      await unlink(local).catch(() => {});
    }
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}
@Controller('playback')
@UseGuards(MemberGuard)
export class PlaybackController {
  @Post('session/:session/cast') async cast(
    @Param('session') session: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const { audio } = parse(z.object({ audio: z.number().int().min(0).max(100).default(0) }), body);
    const access = await db.playback.findUnique({ where: { id: hash(session) } });
    if (!access || access.userId !== req.user.id || access.expiresAt <= new Date())
      throw new ForbiddenException('Reopen the player before casting.');
    const episode = await db.episode.findUniqueOrThrow({ where: { id: access.episodeId } });
    if (!(access.preview && req.user.role === 'ADMIN'))
      await requireWatch(req.user.id, episode.titleId);
    const ticket = token();
    await redis.set(
      `cast:${hash(ticket)}`,
      JSON.stringify({ session, userId: req.user.id, audio }),
      'EX',
      Math.max(1, Math.floor((access.expiresAt.getTime() - Date.now()) / 1000)),
    );
    return { ticket, url: `${origin.replace(/\/$/, '')}/api/playback/cast/${ticket}/master.m3u8` };
  }
  @Post('session/:session/cast/stop') async stopCast(
    @Param('session') session: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const { ticket } = parse(z.object({ ticket: z.string().regex(/^[a-f0-9]{64}$/) }), body);
    const saved = await redis.get(`cast:${hash(ticket)}`);
    if (saved) {
      const access = JSON.parse(saved);
      if (access.userId !== req.user.id || access.session !== session)
        throw new ForbiddenException();
      await redis.del(`cast:${hash(ticket)}`);
    }
    return { ok: true };
  }
  @Post(':episodeId') async start(
    @Param('episodeId') episodeId: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const { preview } = parse(z.object({ preview: z.boolean().default(false) }), body);
    if (preview && req.user.role !== 'ADMIN') throw new ForbiddenException();
    const episode = await db.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { asset: true },
    });
    if (!preview) await requireWatch(req.user.id, episode.titleId);
    if (!episode.asset) throw new NotFoundException('This episode is still processing.');
    await db.playback.deleteMany({ where: { userId: req.user.id, expiresAt: { lt: new Date() } } });
    const sessions = await db.playback.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (sessions.length >= 2)
      await db.playback.deleteMany({ where: { id: { in: sessions.slice(1).map((x) => x.id) } } });
    const raw = token();
    await db.playback.create({
      data: {
        id: hash(raw),
        userId: req.user.id,
        episodeId,
        preview,
        expiresAt: new Date(Date.now() + 4 * 3600000),
      },
    });
    const progress = await db.progress.findUnique({
      where: { userId_episodeId: { userId: req.user.id, episodeId } },
    });
    const manifest = episode.asset.manifest as unknown as MediaManifest;
    return {
      url: `/api/playback/session/${raw}/master.m3u8`,
      position:
        progress && progress.seconds > 0 && progress.seconds < episode.duration - 20
          ? progress.seconds
          : 0,
      watermark: hash(req.user.id).slice(0, 8),
      subtitles: Object.keys(manifest.files)
        .filter((x) => x.endsWith('.vtt'))
        .map((name) => ({
          label: name.replace('.vtt', ''),
          url: `/api/playback/session/${raw}/${name}`,
        })),
    };
  }
  @Get('session/:session/:file') async file(
    @Param('session') session: string,
    @Param('file') file: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
    castAudio?: number,
  ) {
    if (!/^[a-f0-9]{64}$/.test(session)) throw new ForbiddenException();
    const access = await db.playback.findUnique({
      where: { id: hash(session) },
      include: {
        episode: {
          include: {
            asset: { include: { storage: true, replicas: { include: { storage: true } } } },
          },
        },
      },
    });
    if (!access || access.userId !== req.user.id || access.expiresAt < new Date())
      throw new ForbiddenException('Playback session expired. Reopen the player.');
    if (!(access.preview && req.user.role === 'ADMIN'))
      await requireWatch(req.user.id, access.episode.titleId);
    const asset = access.episode.asset;
    if (!asset) throw new NotFoundException();
    const manifest = asset.manifest as unknown as MediaManifest;
    res.setHeader('Cache-Control', 'private, no-store');
    if (file === 'master.m3u8') {
      let index = 0;
      const master =
        castAudio === undefined
          ? manifest.master
          : manifest.master.replace(/^#EXT-X-MEDIA:TYPE=AUDIO,.*$/gm, (line) => {
              const selected = index++ === castAudio;
              return line
                .replace(/DEFAULT=(YES|NO)/, `DEFAULT=${selected ? 'YES' : 'NO'}`)
                .replace(/AUTOSELECT=(YES|NO)/, `AUTOSELECT=${selected ? 'YES' : 'NO'}`);
            });
      return res.type('application/vnd.apple.mpegurl').send(master);
    }
    if (Object.prototype.hasOwnProperty.call(manifest.playlists, file))
      return res.type('application/vnd.apple.mpegurl').send(manifest.playlists[file]);
    if (!Object.prototype.hasOwnProperty.call(manifest.files, file)) throw new NotFoundException();
    const segment = manifest.files[file];
    for (const source of [asset.storage, ...asset.replicas.map((r) => r.storage)]) {
      if (await redis.get(`storage-unavailable:${source.id}`)) continue;
      try {
        const bytes = await ciphertext(segment.object, source);
        const plain = decrypt(
          bytes,
          Buffer.from(unseal(asset.keyEncrypted), 'hex'),
          segment.object,
        );
        prefetch(file, manifest, source);
        return res.type(segment.type).send(plain);
      } catch {
        forgetCipher(`media:${hash(source.bucket + segment.object)}`);
        await redis.set(`storage-unavailable:${source.id}`, '1', 'EX', 30);
      }
    }
    throw new BadRequestException('Media storage is temporarily unavailable. Retry in a moment.');
  }
}
// A receiver cannot send the member's browser cookie. The scoped, expiring
// capability grants only this playback; account and entitlement checks still apply.
@Controller('playback/cast')
export class CastPlaybackController {
  @Get(':ticket/:file') async file(
    @Param('ticket') ticket: string,
    @Param('file') file: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    if (!/^[a-f0-9]{64}$/.test(ticket)) throw new ForbiddenException();
    const saved = await redis.get(`cast:${hash(ticket)}`);
    if (!saved) throw new ForbiddenException('Cast session expired.');
    const access = JSON.parse(saved) as { session: string; userId: string; audio: number };
    const user = await db.user.findUnique({ where: { id: access.userId } });
    if (!user || user.disabled) throw new ForbiddenException();
    req.user = user;
    return new PlaybackController().file(access.session, file, req, res, access.audio);
  }
}
@Controller('admin/subtitles')
@UseGuards(AdminGuard)
export class SubtitleController {
  @Post(':episodeId') async add(@Param('episodeId') episodeId: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        language: z.string().regex(/^[a-zA-Z0-9 -]{2,30}$/),
        text: z.string().max(1500000).startsWith('WEBVTT'),
      }),
      body,
    );
    const asset = await db.asset.findUniqueOrThrow({
      where: { episodeId },
      include: { storage: true },
    });
    const object = `${token()}/${token()}.bin`;
    const local = join(dataDir, 'fetch', token());
    await mkdir(join(dataDir, 'fetch'), { recursive: true });
    try {
      await writeFile(
        local,
        encrypt(Buffer.from(input.text), Buffer.from(unseal(asset.keyEncrypted), 'hex'), object),
      );
      await hf({
        op: 'upload',
        bucket: asset.storage.bucket,
        token: unseal(asset.storage.tokenEncrypted),
        files: [{ local, object }],
      });
      await db.$transaction(async (tx) => {
        const locked = await tx.asset.updateMany({
          where: { id: asset.id, keyEncrypted: asset.keyEncrypted, storageId: asset.storageId },
          data: { bytes: asset.bytes },
        });
        if (!locked.count)
          throw new BadRequestException('Media changed while uploading subtitles. Try again.');
        const current = await tx.asset.findUniqueOrThrow({ where: { id: asset.id } });
        const manifest = current.manifest as unknown as MediaManifest;
        manifest.files[`${input.language}.vtt`] = { object, type: 'text/vtt' };
        await tx.asset.update({
          where: { id: asset.id },
          data: { manifest: JSON.parse(JSON.stringify(manifest)) },
        });
        await tx.assetReplica.deleteMany({ where: { assetId: asset.id } });
      });
      return { ok: true };
    } finally {
      await unlink(local).catch(() => {});
    }
  }
}
