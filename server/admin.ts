import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { db, parse, seal, unseal, token, hash, audit, origin, type AuthRequest } from './core';
import { AdminGuard } from './auth';
import { hf } from './storage';
const artwork = z
  .string()
  .max(2000)
  .refine(
    (v) => v.startsWith('/art/') || v.startsWith('/api/artwork/') || /^https:\/\//.test(v),
    'Use an uploaded image or HTTPS image URL',
  );
const titleSchema = z.object({
  name: z.string().trim().min(1).max(150),
  synopsis: z.string().max(4000),
  format: z.enum(['MOVIE', 'SERIES']),
  category: z.enum(['ANIME', 'CARTOON', 'LIVE_ACTION']),
  genres: z.array(z.string().max(40)).max(12),
  languages: z.array(z.string().max(40)).max(12),
  year: z.number().int().min(1900).max(2100),
  ageRating: z.string().max(12),
  poster: artwork,
  backdrop: artwork,
  featured: z.boolean(),
  rightsNote: z.string().max(2000).default(''),
  availableUntil: z.string().datetime().nullable().optional(),
});
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('overview') async overview() {
    const [members, titles, orders, uploads, audits] = await Promise.all([
      db.user.count(),
      db.title.count(),
      db.order.aggregate({ where: { status: 'PAID' }, _sum: { amount: true }, _count: true }),
      db.upload.findMany({
        take: 12,
        orderBy: { createdAt: 'desc' },
        include: { episode: { include: { title: { select: { name: true } } } } },
      }),
      db.audit.findMany({ take: 20, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      members,
      titles,
      revenue: orders._sum.amount || 0,
      purchases: orders._count,
      uploads,
      audits,
    };
  }
  @Get('titles') titles() {
    return db.title.findMany({
      include: {
        products: { where: { active: true } },
        episodes: {
          orderBy: [{ season: 'asc' }, { number: 'asc' }],
          include: {
            asset: { select: { id: true, bytes: true, storageId: true } },
            uploads: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('titles') async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = parse(titleSchema, body);
    const slug =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      token().slice(0, 6);
    const title = await db.title.create({
      data: {
        ...input,
        slug,
        products: { create: { mode: 'FREE' } },
        ...(input.format === 'MOVIE' ? { episodes: { create: { name: input.name } } } : {}),
      },
    });
    await audit(req.user.id, 'TITLE_CREATED', title.id);
    return title;
  }
  @Post('titles/:id') async edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(titleSchema, body);
    const result = await db.$transaction(async (tx) => {
      // Serialize format changes with episode creation; uploaded media keeps its episode ID.
      const current = await tx.title.update({ where: { id }, data: { updatedAt: new Date() } });
      if (input.format !== current.format) {
        if (current.status === 'PUBLISHED')
          throw new ConflictException('Unpublish this title before changing its format.');
        const episodes = await tx.episode.findMany({ where: { titleId: id } });
        if (input.format === 'MOVIE') {
          if (episodes.length > 1)
            throw new BadRequestException(
              'A movie can contain only one video entry. This series has multiple episodes; they cannot be combined or removed automatically.',
            );
          if (episodes.length === 1)
            await tx.episode.update({
              where: { id: episodes[0].id },
              data: { season: 1, number: 1 },
            });
          else await tx.episode.create({ data: { titleId: id, name: input.name } });
        }
      }
      return tx.title.update({ where: { id }, data: input });
    });
    await audit(req.user.id, 'TITLE_UPDATED', id);
    return result;
  }
  @Post('titles/:id/publish') async publish(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const { published } = parse(z.object({ published: z.boolean() }), body);
    const title = await db.title.findUniqueOrThrow({
      where: { id },
      include: {
        episodes: {
          include: {
            asset: true,
            uploads: { where: { state: { notIn: ['READY', 'FAILED', 'CANCELLED'] } } },
          },
        },
      },
    });
    if (published) {
      if (!title.episodes.length)
        throw new BadRequestException(
          'Add a video entry and finish uploading before publishing. If this is a movie, select Movie in Edit details.',
        );
      const unfinished = title.episodes.filter(
        (episode) => !episode.asset || episode.uploads.length > 0,
      );
      if (unfinished.length)
        throw new BadRequestException(
          `Finish processing before publishing: ${unfinished
            .slice(0, 5)
            .map((episode) => episode.name)
            .join(
              ', ',
            )}${unfinished.length > 5 ? '…' : ''}. You can correct Movie / Series in Edit details.`,
        );
    }
    await db.title.update({
      where: { id },
      data: { status: published ? 'PUBLISHED' : 'DRAFT', showcase: false },
    });
    await audit(req.user.id, published ? 'TITLE_PUBLISHED' : 'TITLE_UNPUBLISHED', id);
    return { ok: true };
  }
  @Post('titles/:id/pricing') async pricing(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(
      z.object({
        mode: z.enum(['FREE', 'PURCHASE', 'RENTAL']),
        pricePaise: z.number().int().min(0).max(10000000),
        rentalHours: z.number().int().min(1).max(8760),
      }),
      body,
    );
    if (input.mode !== 'FREE' && input.pricePaise < 100)
      throw new BadRequestException('Paid access must cost at least ₹1.');
    const product = await db.$transaction(async (tx) => {
      await tx.title.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.product.updateMany({
        where: { titleId: id, active: true },
        data: { active: false },
      });
      return tx.product.create({
        data: { titleId: id, ...input, pricePaise: input.mode === 'FREE' ? 0 : input.pricePaise },
      });
    });
    await audit(req.user.id, 'PRICING_UPDATED', id);
    return product;
  }
  @Post('titles/:id/episodes') async episode(@Param('id') titleId: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        name: z.string().min(1).max(200),
        season: z.number().int().min(1).max(1000),
        number: z.number().int().min(1).max(10000),
        introStart: z.number().min(0).default(0),
        introEnd: z.number().min(0).default(0),
        outroStart: z.number().min(0).default(0),
        outroEnd: z.number().min(0).default(0),
      }),
      body,
    );
    if ((input.introEnd ?? 0) < (input.introStart ?? 0))
      throw new BadRequestException('Intro end must be after its start.');
    if ((input.outroEnd ?? 0) < (input.outroStart ?? 0))
      throw new BadRequestException('Outro end must be after its start.');
    return db.$transaction(async (tx) => {
      const title = await tx.title.update({
        where: { id: titleId },
        data: { updatedAt: new Date() },
      });
      if (title.format === 'MOVIE')
        throw new BadRequestException('Movies already have one video entry.');
      if (title.status === 'PUBLISHED')
        throw new ConflictException(
          'Unpublish before adding episodes, then publish when media is ready.',
        );
      return tx.episode.create({ data: { titleId, ...input } });
    });
  }
  @Get('storage') storage() {
    return db.storage.findMany({
      select: {
        id: true,
        name: true,
        bucket: true,
        enabled: true,
        health: true,
        _count: { select: { assets: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  @Post('titles/:id/sequence') async sequence(@Param('id') id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        reorder: z.boolean().default(false),
        season: z.number().int().min(1),
        episodes: z
          .array(z.object({ id: z.string(), name: z.string().trim().min(1).max(200) }))
          .min(1)
          .max(10000),
      }),
      body,
    );
    if (new Set(input.episodes.map((e) => e.id)).size !== input.episodes.length)
      throw new BadRequestException('Each episode must appear once.');
    return db.$transaction(
      async (tx) => {
        const title = await tx.title.update({ where: { id }, data: { updatedAt: new Date() } });
        if (title.format !== 'SERIES')
          throw new BadRequestException('Sequence editing is for series.');
        const rows = await tx.episode.findMany({ where: { titleId: id, season: input.season } });
        if (
          rows.length !== input.episodes.length ||
          rows.some((e) => !input.episodes.some((selected) => selected.id === e.id))
        )
          throw new BadRequestException('The season changed. Reopen the sequence editor.');
        // Move outside the existing number range before assigning final positions,
        // so swaps cannot violate the unique season/episode constraint.
        const offset = Math.max(0, ...rows.map((e) => e.number)) + rows.length + 1;
        for (let i = 0; input.reorder && i < input.episodes.length; i++)
          await tx.episode.update({
            where: { id: input.episodes[i].id },
            data: { number: offset + i },
          });
        for (let i = 0; i < input.episodes.length; i++)
          await tx.episode.update({
            where: { id: input.episodes[i].id },
            data: { ...(input.reorder ? { number: i + 1 } : {}), name: input.episodes[i].name },
          });
        return { ok: true };
      },
      { timeout: 60000 },
    );
  }
  @Post('episodes/:id') async editEpisode(@Param('id') id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        name: z.string().min(1).max(200),
        season: z.number().int().min(1),
        number: z.number().int().min(1),
        introStart: z.number().min(0),
        introEnd: z.number().min(0),
        outroStart: z.number().min(0).default(0),
        outroEnd: z.number().min(0).default(0),
      }),
      body,
    );
    if (input.introEnd < input.introStart)
      throw new BadRequestException('Intro end must be after its start.');
    if ((input.outroEnd ?? 0) < (input.outroStart ?? 0))
      throw new BadRequestException('Outro end must be after its start.');
    const episode = await db.episode.findUniqueOrThrow({ where: { id }, include: { title: true } });
    if (episode.title.format === 'MOVIE' && (input.season !== 1 || input.number !== 1))
      throw new BadRequestException('Movie file must remain entry 1.');
    if (episode.duration > 0 && input.introEnd > episode.duration)
      throw new BadRequestException('Intro cannot extend beyond the video.');
    if (episode.duration > 0 && (input.outroEnd ?? 0) > episode.duration)
      throw new BadRequestException('Outro cannot extend beyond the video.');
    return db.episode.update({ where: { id }, data: input });
  }
  @Post('storage') async addStorage(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = parse(
      z.object({
        name: z.string().min(1).max(100),
        bucket: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/),
        token: z.string().min(10).max(500),
        createBucket: z.boolean().default(false),
        private: z.boolean().default(false),
      }),
      body,
    );
    if (await db.storage.findFirst({ where: { bucket: input.bucket } }))
      throw new ConflictException('This bucket is already connected.');
    if (input.createBucket)
      await hf({ op: 'create', bucket: input.bucket, token: input.token, private: input.private });
    await hf({ op: 'check', bucket: input.bucket, token: input.token });
    const result = await db.storage.create({
      data: {
        name: input.name,
        bucket: input.bucket,
        tokenEncrypted: seal(input.token),
        health: 'CONNECTED',
      },
    });
    await audit(req.user.id, 'STORAGE_ADDED', result.id);
    return { id: result.id };
  }
  @Post('storage/discover') async discover(@Body() body: unknown) {
    const input = parse(
      z.object({
        token: z.string().min(10).max(500),
        namespace: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .optional(),
      }),
      body,
    );
    return hf({ op: 'discover', ...input });
  }
  @Post('storage/:id/buckets') async createBucket(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(
      z.object({
        name: z.string().min(1).max(100),
        bucketName: z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/),
        private: z.boolean(),
      }),
      body,
    );
    const existing = await db.storage.findUniqueOrThrow({ where: { id } });
    const bucket = `${existing.bucket.split('/')[0]}/${input.bucketName}`;
    if (await db.storage.findFirst({ where: { bucket } }))
      throw new ConflictException('This bucket is already connected.');
    await hf({
      op: 'create',
      bucket,
      token: unseal(existing.tokenEncrypted),
      private: input.private,
    });
    const result = await db.storage.create({
      data: {
        name: input.name,
        bucket,
        tokenEncrypted: existing.tokenEncrypted,
        health: 'CONNECTED',
      },
    });
    await audit(req.user.id, 'BUCKET_CREATED', result.id);
    return { id: result.id };
  }
  @Post('storage/:id/visibility') async visibility(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const { private: isPrivate } = parse(z.object({ private: z.boolean() }), body);
    const storage = await db.storage.findUniqueOrThrow({ where: { id } });
    await hf({
      op: 'visibility',
      bucket: storage.bucket,
      token: unseal(storage.tokenEncrypted),
      private: isPrivate,
    });
    await audit(req.user.id, 'BUCKET_VISIBILITY_CHANGED', id);
    return { ok: true };
  }
  @Post('storage/:id') async editStorage(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(
      z.object({ enabled: z.boolean().optional(), token: z.string().min(10).max(500).optional() }),
      body,
    );
    const storage = await db.storage.findUniqueOrThrow({ where: { id } });
    if (input.token) await hf({ op: 'check', bucket: storage.bucket, token: input.token });
    await db.storage.update({
      where: { id },
      data: {
        enabled: input.enabled,
        ...(input.token ? { tokenEncrypted: seal(input.token), health: 'CONNECTED' } : {}),
      },
    });
    await audit(req.user.id, 'STORAGE_UPDATED', id);
    return { ok: true };
  }
  @Post('storage/:id/check') async checkStorage(@Param('id') id: string) {
    const storage = await db.storage.findUniqueOrThrow({ where: { id } });
    try {
      await hf({ op: 'check', bucket: storage.bucket, token: unseal(storage.tokenEncrypted) });
      await db.storage.update({ where: { id }, data: { health: 'CONNECTED' } });
      return { ok: true };
    } catch {
      await db.storage.update({ where: { id }, data: { health: 'ERROR' } });
      throw new BadRequestException('Unable to read bucket. Check its name and token permissions.');
    }
  }
  @Get('members') members() {
    return db.user.findMany({
      select: { id: true, name: true, email: true, role: true, disabled: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('members/:id') async member(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const { disabled } = parse(z.object({ disabled: z.boolean() }), body);
    const target = await db.user.findUniqueOrThrow({ where: { id } });
    if (target.role === 'ADMIN')
      throw new BadRequestException('Admin accounts cannot be disabled here.');
    await db.$transaction([
      db.user.update({ where: { id }, data: { disabled } }),
      db.session.deleteMany({ where: { userId: id } }),
      db.playback.deleteMany({ where: { userId: id } }),
    ]);
    await audit(req.user.id, disabled ? 'MEMBER_DISABLED' : 'MEMBER_ENABLED', id);
    return { ok: true };
  }
  @Post('invites') async invite(@Body() body: unknown, @Req() req: AuthRequest) {
    const { email } = parse(z.object({ email: z.string().email().optional() }), body);
    const raw = token();
    await db.invite.create({
      data: {
        tokenHash: hash(raw),
        email: email?.toLowerCase(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await audit(req.user.id, 'INVITE_CREATED', email || 'Any email');
    return { url: `${origin}/login?invite=${raw}` };
  }
  @Get('collections') collections() {
    return db.collection.findMany({
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { position: 'asc' },
    });
  }
  @Post('collections') async collection(@Body() body: unknown) {
    const input = parse(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(100),
        position: z.number().int().min(0),
        enabled: z.boolean(),
        titleIds: z.array(z.string()).max(50),
      }),
      body,
    );
    if (new Set(input.titleIds).size !== input.titleIds.length)
      throw new BadRequestException('A title can only appear once per collection.');
    return db.$transaction(async (tx) => {
      const collection = input.id
        ? await tx.collection.update({
            where: { id: input.id },
            data: { name: input.name, position: input.position, enabled: input.enabled },
          })
        : await tx.collection.create({
            data: { name: input.name, position: input.position, enabled: input.enabled },
          });
      await tx.collectionItem.deleteMany({ where: { collectionId: collection.id } });
      await tx.collectionItem.createMany({
        data: input.titleIds.map((titleId, position) => ({
          titleId,
          position,
          collectionId: collection.id,
        })),
      });
      return collection;
    });
  }
  @Post('collections/:id/delete') async deleteCollection(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    await db.collection.delete({ where: { id } });
    await audit(req.user.id, 'COLLECTION_DELETED', id);
    return { ok: true };
  }
  @Get('orders') orders() {
    return db.order.findMany({
      include: {
        user: { select: { name: true, email: true } },
        product: { include: { title: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
